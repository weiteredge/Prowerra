#include <napi.h>
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011
#endif

Napi::Value ExcludeFromCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    HWND hwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    BOOL ok = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
    return Napi::Boolean::New(env, ok);
}

Napi::Value IncludeInCapture(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    HWND hwnd = (HWND)(uintptr_t)info[0].As<Napi::Number>().Int64Value();
    BOOL ok = SetWindowDisplayAffinity(hwnd, WDA_NONE);
    return Napi::Boolean::New(env, ok);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("exclude", Napi::Function::New(env, ExcludeFromCapture));
    exports.Set("include", Napi::Function::New(env, IncludeInCapture));
    return exports;
}

NODE_API_MODULE(display_affinity, Init)
