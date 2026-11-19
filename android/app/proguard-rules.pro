# Keep Capacitor plugins, JS bridge annotations, and WebView interfaces intact under R8 release shrinking
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class app.noi.vietnamese.** { *; }
