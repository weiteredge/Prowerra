{
  "targets": [
    {
      "target_name": "display_affinity",
      "sources": [ "src/display_affinity.cc" ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS=1" ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [ "user32.lib" ]
        }]
      ]
    }
  ]
}
