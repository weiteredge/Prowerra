const WebSocket = require("ws");
const ffmpegPath = require("ffmpeg-static");
const { spawn } = require("child_process");

let recording;
let ws;
let overlayWindow;

let transcriptBuffer = "";
let bufferTimer = null;
// Optimized flush interval for faster responses
const flushIntervalMs = 1200; // 1.2 seconds for faster processing

// Response timing controls
let lastResponseTime = 0;
let isProcessingResponse = false;
const minResponseDisplayTime = 1000; // Minimum 1 second between responses

let currentGeminiKey = null;
let currentGeminiModel = "gemini-2.5-flash";

// ===== Resolve ffmpeg binary correctly =====
function resolveFfmpeg() {
  if (!ffmpegPath) throw new Error("FFmpeg binary not found!");
  return ffmpegPath.replace("app.asar", "app.asar.unpacked");
}

// ===== Audio Capture =====
function startAudioCapture(deviceName = "CABLE Output (VB-Audio Virtual Cable)") {
  const ffmpeg = resolveFfmpeg();

  recording = spawn(ffmpeg, [
    "-f", "dshow",
    "-i", `audio=${deviceName}`,
    "-ac", "1",
    "-ar", "16000",
    "-f", "s16le",
    "pipe:1",
  ]);

  recording.stdout.on("data", (chunk) => sendAudioData(chunk));
  recording.stderr.on("data", () => {}); // Suppress FFmpeg output
  recording.on("error", () => {}); // Suppress error output
  recording.on("close", () => {}); // Suppress close message
}

function stopAudioCapture() {
  if (recording) {
    recording.kill("SIGINT");
    recording = null;
  }
}

// ===== AssemblyAI =====
function startTranscription(assemblyKey, deviceName) {
  const SAMPLE_RATE = 16000;
  ws = new WebSocket(
    `wss://streaming.assemblyai.com/v3/ws?sample_rate=${SAMPLE_RATE}&encoding=pcm_s16le`,
    { headers: { authorization: assemblyKey } }
  );

  ws.on("open", () => {
    overlayWindow.webContents.send("connection-status", "connected");
    startAudioCapture(deviceName);
    startBufferTimer();
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === "Turn" && data.transcript) {
        overlayWindow.webContents.send("transcription", data.transcript);
        appendToBuffer(data.transcript);
      }
    } catch (e) {
      console.error("❌ Error parsing message:", e);
    }
  });

  ws.on("close", () => {
    overlayWindow.webContents.send("connection-status", "disconnected");
    stopAudioCapture();
    stopBufferTimer();
  });

  ws.on("error", (err) => {
    console.error("⚠️ WebSocket error:", err);
    overlayWindow.webContents.send("error", err.message);
  });
}

function stopTranscription() {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ terminate_session: true }));
    ws.close();
  }
  ws = null;
  stopAudioCapture();
  stopBufferTimer();
}

// ===== Send Audio =====
function sendAudioData(audioBuffer) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(audioBuffer);
  }
}

// ===== Buffer Helpers =====

let mode = 'interview'; // 'interview' or 'qa'

function appendToBuffer(text) {
  if (!text || typeof text !== 'string') return;
  
  // Check if we should switch modes
  if (text.toLowerCase().includes('code mode')) {
    mode = 'qa';
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("mode-change", "qa");
    }
    return;
  } else if (text.toLowerCase().includes('interview mode')) {
    mode = 'interview';
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send("mode-change", "interview");
    }
    return;
  }
  
  // Add space if buffer is not empty
  if (transcriptBuffer) {
    transcriptBuffer += ' ';
  }
  transcriptBuffer += text.trim();
}

function startBufferTimer() {
  if (bufferTimer) return;
  bufferTimer = setInterval(async () => {
    if (!transcriptBuffer) return;
    
    // Prevent rapid response processing
    const now = Date.now();
    if (isProcessingResponse || (now - lastResponseTime < minResponseDisplayTime)) {
      return; // Skip this cycle to let previous response be visible
    }
    
    const text = transcriptBuffer.trim();
    
    // Process with shorter text for faster responses (avoid processing very short fragments)
    if (text.length < 6) return;
    
    transcriptBuffer = ""; // Clear buffer after getting text
    isProcessingResponse = true;
    
    try {
      let response;
      if (mode === 'interview') {
        response = await processInterviewQuestion(text);
      } else {
        response = await processQAQuestion(text);
      }
      
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send("gemini-response", response);
        lastResponseTime = Date.now();
      }
    } catch (err) {
      console.error('Error processing transcript:', err);
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send("error", `Prowerra ${mode} error: ` + (err.message || 'Unknown error'));
      }
    } finally {
      isProcessingResponse = false;
    }
  }, flushIntervalMs);
}

function stopBufferTimer() {
  if (bufferTimer) {
    clearInterval(bufferTimer);
    bufferTimer = null;
  }
}

// ===== Conversation Histories =====
let interviewHistory = [
  {
    role: "user",
    parts: [{
      text: "You are my interview assistant. For non-technical questions, provide short, direct, professional first-person answers (2-3 sentences max). For coding/SQL/technical questions, provide a brief explanation (1-2 sentences) followed by clean, working code in proper markdown code blocks. Always be concise and professional."
    }]
  }
];

let qaHistory = [
  {
    role: "user",
    parts: [{
      text: "You are a helpful coding and general knowledge assistant. Provide clear explanations and complete working code if asked. For code, use markdown code blocks with language specification. Be concise but thorough in explanations."
    }]
  }
];

function addToHistory(history, role, text) {
  const newHistory = [...history, { role, parts: [{ text }] }];
  // Keep last 8 messages for faster processing (reduced from 20)
  return newHistory.slice(-8);
}

// ===== Prowerra (shared) =====
async function callGemini(history) {
  if (!currentGeminiKey) throw new Error("Prowerra API key missing. Enter it in overlay.");

  const payload = {
    contents: history,
    generationConfig: {
      thinkingConfig: { thinkingBudget: 0 },
      // Reduce maxOutputTokens for faster responses; long code snippets still supported via follow-ups
      maxOutputTokens: 300, // Reduced for faster responses
      temperature: 0.1, // Lower for faster, more focused responses
      topP: 0.7, // Reduced for faster generation
      topK: 20, // Reduced for faster generation
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentGeminiModel)}:generateContent`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": currentGeminiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Prowerra API error:', { status: res.status, error: errorText });
      throw new Error(`Prowerra API error: ${res.status} - ${errorText}`);
    }

    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ||
           data?.candidates?.[0]?.text ||
           JSON.stringify(data);
  } catch (error) {
    console.error('Network error calling Prowerra:', error);
    throw new Error(`Network error: ${error.message}`);
  }
}

// Helper function to clean up AI responses
function trimReply(text) {
  if (!text) return '';
  // Remove any leading/trailing whitespace
  let result = text.trim();
  // Remove any markdown code block markers
  result = result.replace(/^```(?:[a-z]*\n)?|```$/g, '').trim();
  // Remove any remaining markdown formatting
  result = result.replace(/\*\*|__/g, '');
  return result;
}

// ===== Processing Functions =====
async function processInterviewQuestion(question) {
  if (!question.trim()) return '';
  
  // Detect if this is a technical/coding question - be very specific to avoid false positives
  const isCodingRequest = /\b(write|show|give|create|generate|build|make|provide|implement|code|program|script|algorithm)\b/i.test(question) && /\b(code|function|class|program|script|algorithm|javascript|js|typescript|ts|python|java|c\+\+|html|css|react|node|nodejs|vue|angular)\b/i.test(question);
  
  // Enhanced SQL detection - catch both explicit requests and data retrieval questions
  const isSQLExplicitRequest = /\b(write|show|give|create|generate|sql|query)\b/i.test(question) && /\b(sql|database|mysql|postgresql|mongodb|sqlite|select|insert|update|delete|join|table|query)\b/i.test(question);
  const isSQLDataQuestion = /\b(find|get|retrieve|select|fetch|display|show)\b/i.test(question) && /\b(salary|employee|data|record|row|table|highest|lowest|maximum|minimum|second|third|rank|database|db)\b/i.test(question);
  const isSQLRequest = isSQLExplicitRequest || isSQLDataQuestion;
  
  // Enhanced explicit code detection for modern frameworks and syntax
  const isExplicitCode = /\b(console\.log|console\.error|console\.warn|def |function |class |import |from |export |require|SELECT |INSERT |UPDATE|useState|useEffect|componentDidMount|app\.get|app\.post|router\.|express|mongoose)\b/i.test(question);
  
  // React/Frontend specific detection
  const isReactRequest = /\b(write|show|create|build|make)\b/i.test(question) && /\b(react|component|jsx|hook|state|props|usestate|useeffect|frontend|ui)\b/i.test(question);
  
  // Node.js/Backend specific detection  
  const isNodeRequest = /\b(write|show|create|build|make)\b/i.test(question) && /\b(node|nodejs|express|server|api|endpoint|backend|middleware|route)\b/i.test(question);
  
  // Only treat as technical if it's an explicit request for code or contains actual code
  const isTechnical = isCodingRequest || isSQLRequest || isExplicitCode || isReactRequest || isNodeRequest;
  
  // Add to interview history
  interviewHistory = addToHistory(
    interviewHistory,
    "user",
    `Interviewer: ${question}`
  );

  try {
    let promptText;
    
    if (isTechnical) {
      // For technical questions, always provide code blocks consistently
      promptText = `The interviewer just asked: "${question}"\n\n` +
                  `CRITICAL: This is a technical/coding/SQL question. You MUST provide:\n` +
                  `1. Brief explanation (1-2 sentences max)\n` +
                  `2. ACTUAL working code/SQL in markdown code blocks\n` +
                  `3. NEVER just describe code - always show the actual code\n` +
                  `4. Use proper language tags (sql, javascript, python, etc.)\n\n` +
                  `REQUIRED FORMAT:\n` +
                  `Brief explanation.\n\n` +
                  `\`\`\`sql\n` +
                  `SELECT column FROM table WHERE condition;\n` +
                  `\`\`\`\n\n` +
                  `DO NOT just explain what you would do - SHOW the actual code!`;
    } else {
      // For non-technical questions, keep it short and personal
      promptText = `The interviewer just asked: "${question}"\n\n` +
                  `Provide a concise, professional response in first person (2-3 sentences max). ` +
                  `Be direct and avoid saying things like "I would say" or "I think". ` +
                  `Focus on your experience and skills relevant to the question.`;
    }
    
    // Call Prowerra with interview context
    let contextHistory;
    if (isTechnical) {
      // For technical questions, use minimal context to ensure consistency
      contextHistory = [
        interviewHistory[0], // Keep the system prompt
        {
          role: "user",
          parts: [{ text: promptText }]
        }
      ];
    } else {
      // For non-technical questions, use full history for context
      contextHistory = [
        ...interviewHistory,
        {
          role: "user",
          parts: [{ text: promptText }]
        }
      ];
    }
    
    const aiReply = await callGemini(contextHistory);
    
    // For technical questions, don't trim code blocks
    let cleanReply;
    if (isTechnical) {
      cleanReply = aiReply.trim();
    } else {
      cleanReply = trimReply(aiReply);
    }
    
    // Add to history and return
    interviewHistory = addToHistory(interviewHistory, "model", cleanReply);
    return cleanReply;
  } catch (err) {
    console.error("Interview processing error:", err);
    throw new Error(`Failed to process interview question: ${err.message}`);
  }
}

async function processQAQuestion(question) {
  if (!question.trim()) return '';
  
  // Check if it's a coding question
  const isCoding = /code|function|class|js|javascript|python|html|css|algorithm/i.test(question);
  const isLog = isLogIntent(question);
  const isOutput = isOutputIntent(question);
  
  // Add to QA history
  qaHistory = addToHistory(qaHistory, "user", question);
  
  try {
    // If user is asking what this logs/prints or what output will be, steer to explanation-only
    if (isOutput) {
      const prompt = `Analyze the following JavaScript snippet and state the final console output.
Respond in plain text only (no code blocks). Use this format:

Output: <the exact output as shown by console>
Reason: <one or two short sentences explaining why>

Snippet:
${question}`;
      qaHistory = addToHistory(qaHistory, "user", prompt);
    }

    // Use existing history and question; allow explanation + code otherwise
    let aiReply = await callGemini(qaHistory);
    
    // For coding requests (including log/print), return explanation + code as-is
    
    // Add to history and return
    qaHistory = addToHistory(qaHistory, "model", aiReply);
    return aiReply;
  } catch (err) {
    console.error("QA processing error:", err);
    throw new Error(`Failed to process QA question: ${err.message}`);
  }
}

// (Removed duplicate extractCodeOnly definition)

// ===== Manual Q&A pipeline =====
async function askProwerra(question) {
  try {
    // Check if question looks like a coding question
    const isCoding = /code|function|class|js|javascript|python/i.test(question);
    const isLog = isLogIntent(question);
    const isOutput = isOutputIntent(question);

    // Prepare the prompt based on context
    let prompt;
    if (isOutput) {
      // For output-evaluation requests, do NOT return code; just final output + reason
      prompt = `Analyze the following JavaScript snippet and state the final console output.
Respond in plain text only (no code blocks). Use this format:

Output: <the exact output as shown by console>
Reason: <one or two short sentences explaining why>

Snippet:
${question}`;
    } else if (isCoding) {
      prompt = `You are a helpful coding assistant. Provide BOTH a brief explanation (1-3 sentences, include expected console output if applicable) and then a fenced code block. Use this exact format:

Explanation:
<one short paragraph that also states the expected console output if it makes sense>

Code:
\`\`\`
<code here>
\`\`\`

Ensure the code is complete and runnable.

Request: ${question}`;
    } else {
      // For non-coding questions, use the general qaHistory context
      prompt = question;
    }

    // Add to appropriate history
    qaHistory = addToHistory(qaHistory, "user", prompt);
    
    // Get response from Prowerra
    const aiReply = await callGemini(qaHistory);
    
    // Add to history and return as-is so renderer can split explanation and code (if any)
    qaHistory = addToHistory(qaHistory, "model", aiReply);
    return aiReply;
  } catch (err) {
    console.error('Error in askProwerra:', err);
    throw new Error(`Failed to get response: ${err.message}`);
  }
}

// Detect output-evaluation intent (e.g., "what will this log" or raw console.log snippet)
function isOutputIntent(text) {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  // Direct console.log at line start
  if (/^console\.log\s*\(/.test(t)) return true;
  // Contains a console.log call anywhere
  if (t.includes('console.log(')) return true;
  // Phrasings asking for output
  if (t.includes('what is the output') || t.includes('what will this log') || t.includes('output of')) return true;
  return false;
}

// Detect logging/printing intent in a question
function isLogIntent(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes('console.log') ||
    /\b(log|print|printf|println|echo)\b/.test(t) ||
    t.includes('system.out.println') ||
    t.includes('console.writeline') ||
    t.includes('cout <<')
  );
}

// Helper to extract code from ```blocks``` if present
function extractCodeOnly(text) {
  const codeMatch = text.match(/```(?:\w*)\n([\s\S]*?)```/);
  if (codeMatch) return codeMatch[1];
  return text; // fallback if no code block
}

// ===== Exports =====
function start(window, { apiKey, deviceName, geminiKey, geminiModel }) {
  overlayWindow = window;
  if (geminiKey) currentGeminiKey = geminiKey;
  if (geminiModel) currentGeminiModel = geminiModel;
  startTranscription(apiKey, deviceName);
  return { success: true };
}

function stop() {
  stopTranscription();
  return { success: true };
}

module.exports = { start, stop, askProwerra };
