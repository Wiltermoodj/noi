package app.noi.vietnamese;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
    name = "NoiAndroid",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class NoiAndroidPlugin extends Plugin {

    private static final String PERM_ALIAS_MIC = "microphone";

    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private final AudioManager.OnAudioFocusChangeListener audioFocusChangeListener = focusChange -> {
        if (focusChange == AudioManager.AUDIOFOCUS_LOSS || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            stopTtsInternal();
        }
    };

    private static final class PendingTtsRequest {
        final PluginCall call;
        final String text;
        final String lang;
        final float rate;
        final float pitch;
        final String voiceURI;

        PendingTtsRequest(PluginCall call, String text, String lang, float rate, float pitch, String voiceURI) {
            this.call = call;
            this.text = text;
            this.lang = lang;
            this.rate = rate;
            this.pitch = pitch;
            this.voiceURI = voiceURI;
        }
    }

    private final Object ttsLock = new Object();
    private volatile boolean isDestroyed = false;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private boolean ttsInitializing = false;
    private PluginCall pendingSpeakCall;
    private PendingTtsRequest queuedColdStartSpeak;
    private String activeUtteranceId;

    private SpeechRecognizer speechRecognizer;
    private boolean isListening = false;
    private int speechSessionCounter = 0;

    @Override
    public void load() {
        super.load();
        isDestroyed = false;
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        initTts();
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        stopSpeechInternal();
        stopTtsInternal();
        abandonAudioFocusInternal();
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        isDestroyed = true;
        if (Looper.myLooper() == Looper.getMainLooper()) {
            stopSpeechOnMainThread();
        } else {
            stopSpeechInternal();
        }
        stopTtsInternal();
        TextToSpeech toShutdown;
        synchronized (ttsLock) {
            toShutdown = tts;
            tts = null;
            ttsReady = false;
            ttsInitializing = false;
        }
        if (toShutdown != null) {
            try {
                toShutdown.setOnUtteranceProgressListener(null);
                toShutdown.shutdown();
            } catch (Exception ignored) {
                // Ignore shutdown errors
            }
        }
        abandonAudioFocusInternal();
    }

    private AudioAttributes buildSpeechAudioAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    }

    private void emitEventIfActive(String eventName, JSObject payload) {
        if (!isDestroyed) {
            notifyListeners(eventName, payload);
        }
    }

    private void initTts() {
        synchronized (ttsLock) {
            if (isDestroyed || tts != null || ttsInitializing) {
                return;
            }
            ttsInitializing = true;
            tts = new TextToSpeech(getContext().getApplicationContext(), status -> {
                boolean readyNow;
                PendingTtsRequest queued;
                synchronized (ttsLock) {
                    ttsInitializing = false;
                    queued = queuedColdStartSpeak;
                    queuedColdStartSpeak = null;
                    if (isDestroyed || tts == null) {
                        ttsReady = false;
                        readyNow = false;
                    } else {
                        ttsReady = status == TextToSpeech.SUCCESS;
                        readyNow = ttsReady;
                        if (readyNow) {
                            tts.setAudioAttributes(buildSpeechAudioAttributes());
                            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                                @Override
                                public void onStart(String utteranceId) {
                                    JSObject event = new JSObject();
                                    event.put("state", "started");
                                    event.put("utteranceId", utteranceId);
                                    emitEventIfActive("ttsState", event);
                                }

                                @Override
                                public void onDone(String utteranceId) {
                                    resolveSpeakCall(utteranceId, true, false);
                                }

                                @Override
                                @SuppressWarnings("deprecation")
                                public void onError(String utteranceId) {
                                    resolveSpeakCall(utteranceId, false, false);
                                }

                                @Override
                                public void onError(String utteranceId, int errorCode) {
                                    resolveSpeakCall(utteranceId, false, false);
                                }

                                @Override
                                public void onStop(String utteranceId, boolean interrupted) {
                                    resolveSpeakCall(utteranceId, false, interrupted);
                                }
                            });
                        }
                    }
                }
                if (readyNow) {
                    emitEventIfActive("ttsVoicesReady", new JSObject());
                    if (queued != null) {
                        dispatchSpeakRequest(queued);
                    }
                } else if (queued != null) {
                    resolveColdStartResult(queued.call, false, false);
                }
            });
        }
    }

    private void resolveColdStartResult(PluginCall call, boolean completed, boolean interrupted) {
        if (call == null) return;
        JSObject res = new JSObject();
        res.put("completed", completed);
        res.put("interrupted", interrupted);
        call.resolve(res);
    }

    private void resolveSpeakCall(String utteranceId, boolean completed, boolean interrupted) {
        PluginCall call;
        synchronized (ttsLock) {
            if (activeUtteranceId != null && !activeUtteranceId.equals(utteranceId)) {
                return;
            }
            activeUtteranceId = null;
            call = pendingSpeakCall;
            pendingSpeakCall = null;
        }
        abandonAudioFocusInternal();
        if (call != null) {
            JSObject result = new JSObject();
            result.put("completed", completed);
            result.put("interrupted", interrupted);
            call.resolve(result);
        }
        JSObject event = new JSObject();
        event.put("state", completed ? "completed" : "stopped");
        event.put("utteranceId", utteranceId);
        emitEventIfActive("ttsState", event);
    }

    private boolean hasRecordAudioPermission() {
        return (
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        );
    }

    @PluginMethod
    public void ensureMicrophonePermission(PluginCall call) {
        if (hasRecordAudioPermission() || getPermissionState(PERM_ALIAS_MIC) == PermissionState.GRANTED) {
            JSObject res = new JSObject();
            res.put("granted", true);
            res.put("state", "granted");
            call.resolve(res);
            return;
        }
        requestPermissionForAlias(PERM_ALIAS_MIC, call, "micPermissionCallback");
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        PermissionState state = getPermissionState(PERM_ALIAS_MIC);
        boolean granted = hasRecordAudioPermission() || state == PermissionState.GRANTED;
        JSObject res = new JSObject();
        res.put("granted", granted);
        res.put("state", state != null ? state.toString() : (granted ? "granted" : "denied"));
        call.resolve(res);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            Uri uri = Uri.fromParts("package", getContext().getPackageName(), null);
            intent.setData(uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception ex) {
            call.reject("Unable to open Android app settings.", ex);
        }
    }

    @PluginMethod
    public void openTtsSettings(PluginCall call) {
        try {
            Intent intent = new Intent("com.android.settings.TTS_SETTINGS");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception ignored) {
            try {
                Intent fallback = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception ex) {
                call.reject("Unable to open Android Text-to-Speech settings.", ex);
            }
        }
    }

    @PluginMethod
    public void requestAudioFocus(PluginCall call) {
        boolean granted = requestAudioFocusInternal();
        JSObject res = new JSObject();
        res.put("granted", granted);
        call.resolve(res);
    }

    @PluginMethod
    public void abandonAudioFocus(PluginCall call) {
        abandonAudioFocusInternal();
        call.resolve();
    }

    private boolean requestAudioFocusInternal() {
        if (audioManager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (audioFocusRequest == null) {
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(buildSpeechAudioAttributes())
                    .setOnAudioFocusChangeListener(audioFocusChangeListener)
                    .build();
            }
            return audioManager.requestAudioFocus(audioFocusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
        return requestAudioFocusLegacy();
    }

    @SuppressWarnings("deprecation")
    private boolean requestAudioFocusLegacy() {
        return (
            audioManager.requestAudioFocus(
                audioFocusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
            ) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        );
    }

    private void abandonAudioFocusInternal() {
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (audioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            }
        } else {
            abandonAudioFocusLegacy();
        }
    }

    @SuppressWarnings("deprecation")
    private void abandonAudioFocusLegacy() {
        audioManager.abandonAudioFocus(audioFocusChangeListener);
    }

    @PluginMethod
    public void getTtsVoices(PluginCall call) {
        initTts();
        JSArray voicesArray = new JSArray();
        TextToSpeech engine;
        boolean ready;
        synchronized (ttsLock) {
            engine = tts;
            ready = ttsReady;
        }
        if (engine != null && ready) {
            try {
                Set<Voice> voices = engine.getVoices();
                if (voices != null) {
                    for (Voice voice : voices) {
                        Locale loc = voice.getLocale();
                        if (loc == null) continue;
                        String langTag = loc.toLanguageTag();
                        String lower = langTag.toLowerCase(Locale.US);
                        if (!lower.startsWith("vi") && !lower.startsWith("en")) {
                            continue;
                        }
                        JSObject item = new JSObject();
                        item.put("voiceURI", voice.getName());
                        item.put("name", voice.getName());
                        item.put("lang", langTag);
                        item.put("localService", !voice.isNetworkConnectionRequired());
                        voicesArray.put(item);
                    }
                }
            } catch (Exception ignored) {
                // Return empty list if engine is temporarily unavailable
            }
        }
        JSObject result = new JSObject();
        result.put("ready", ready);
        result.put("voices", voicesArray);
        call.resolve(result);
    }

    @PluginMethod
    public void speakTts(PluginCall call) {
        String text = call.getString("text", "").trim();
        String lang = call.getString("lang", "vi-VN");
        float rate = call.getFloat("rate", 1.0f);
        float pitch = call.getFloat("pitch", 1.0f);
        String voiceURI = call.getString("voiceURI", "");

        if (text.isEmpty()) {
            resolveColdStartResult(call, false, false);
            return;
        }

        stopTtsInternal();
        dispatchSpeakRequest(new PendingTtsRequest(call, text, lang, rate, pitch, voiceURI));
    }

    private void dispatchSpeakRequest(PendingTtsRequest req) {
        String utteranceId = UUID.randomUUID().toString();
        int speakStatus = TextToSpeech.ERROR;
        boolean shouldFocus = false;
        boolean queuedForInit = false;
        boolean immediateFail = false;
        PluginCall supersededCall = null;

        synchronized (ttsLock) {
            if (isDestroyed) {
                immediateFail = true;
            } else if (tts == null || !ttsReady) {
                if (queuedColdStartSpeak != null) {
                    supersededCall = queuedColdStartSpeak.call;
                }
                queuedColdStartSpeak = req;
                queuedForInit = true;
            } else {
                shouldFocus = true;
            }
        }

        if (supersededCall != null) {
            resolveColdStartResult(supersededCall, false, true);
        }
        if (immediateFail) {
            resolveColdStartResult(req.call, false, false);
            return;
        }
        if (queuedForInit) {
            initTts();
            return;
        }

        if (shouldFocus) {
            requestAudioFocusInternal();
        }

        boolean reQueuedForInit = false;
        boolean langUnsupported = false;

        synchronized (ttsLock) {
            if (isDestroyed || tts == null || !ttsReady) {
                if (queuedColdStartSpeak != null) {
                    supersededCall = queuedColdStartSpeak.call;
                }
                queuedColdStartSpeak = req;
                reQueuedForInit = true;
            } else {
                Locale targetLocale = Locale.forLanguageTag(req.lang);
                boolean voiceMatched = false;
                if (req.voiceURI != null && !req.voiceURI.isEmpty()) {
                    try {
                        Set<Voice> voices = tts.getVoices();
                        if (voices != null) {
                            for (Voice v : voices) {
                                if (req.voiceURI.equals(v.getName())) {
                                    int voiceRes = tts.setVoice(v);
                                    voiceMatched = voiceRes == TextToSpeech.SUCCESS;
                                    break;
                                }
                            }
                        }
                    } catch (Exception ignored) {
                        // Fall back to language matching
                    }
                }

                if (!voiceMatched) {
                    int langResult = tts.setLanguage(targetLocale);
                    if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                        langUnsupported = true;
                    }
                }

                if (!langUnsupported) {
                    tts.setSpeechRate(Math.max(0.25f, Math.min(2.0f, req.rate)));
                    tts.setPitch(Math.max(0.5f, Math.min(2.0f, req.pitch)));
                    activeUtteranceId = utteranceId;
                    pendingSpeakCall = req.call;
                    try {
                        speakStatus = tts.speak(req.text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
                    } catch (Exception ignored) {
                        speakStatus = TextToSpeech.ERROR;
                    }
                }
            }
        }

        if (supersededCall != null) {
            resolveColdStartResult(supersededCall, false, true);
        }
        if (reQueuedForInit) {
            abandonAudioFocusInternal();
            initTts();
            return;
        }
        if (langUnsupported) {
            abandonAudioFocusInternal();
            resolveColdStartResult(req.call, false, false);
            return;
        }

        if (speakStatus != TextToSpeech.SUCCESS) {
            resolveSpeakCall(utteranceId, false, false);
        }
    }

    @PluginMethod
    public void stopTts(PluginCall call) {
        stopTtsInternal();
        call.resolve();
    }

    private void stopTtsInternal() {
        String prevId;
        PluginCall prevCall;
        PendingTtsRequest queued;
        TextToSpeech engine;
        synchronized (ttsLock) {
            prevId = activeUtteranceId;
            prevCall = pendingSpeakCall;
            queued = queuedColdStartSpeak;
            activeUtteranceId = null;
            pendingSpeakCall = null;
            queuedColdStartSpeak = null;
            engine = tts;
        }
        if (engine != null) {
            try {
                engine.stop();
            } catch (Exception ignored) {
                // Ignore stop errors
            }
        }
        abandonAudioFocusInternal();
        if (queued != null) {
            resolveColdStartResult(queued.call, false, true);
        }
        if (prevCall != null) {
            JSObject result = new JSObject();
            result.put("completed", false);
            result.put("interrupted", true);
            prevCall.resolve(result);
        }
        if (prevId != null) {
            JSObject event = new JSObject();
            event.put("state", "stopped");
            event.put("utteranceId", prevId);
            emitEventIfActive("ttsState", event);
        }
    }

    @PluginMethod
    public void isSpeechRecognitionAvailable(PluginCall call) {
        boolean available = SpeechRecognizer.isRecognitionAvailable(getContext());
        JSObject result = new JSObject();
        result.put("available", available);
        call.resolve(result);
    }

    @PluginMethod
    public void startSpeechRecognition(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            emitSpeechError("unsupported", "Speech recognition service is unavailable on this Android device.");
            emitEventIfActive("speechEnd", new JSObject());
            call.resolve();
            return;
        }

        if (!hasRecordAudioPermission()) {
            requestPermissionForAlias(PERM_ALIAS_MIC, call, "speechMicPermissionCallback");
            return;
        }

        startSpeechOnMainThread(call.getString("lang", "vi-VN"));
        call.resolve();
    }

    @PermissionCallback
    private void speechMicPermissionCallback(PluginCall call) {
        if (!hasRecordAudioPermission()) {
            emitSpeechError(
                "permission-denied",
                "Microphone access was blocked. Allow microphone permission to practice speaking."
            );
            emitEventIfActive("speechEnd", new JSObject());
            call.resolve();
            return;
        }
        startSpeechOnMainThread(call.getString("lang", "vi-VN"));
        call.resolve();
    }

    private void startSpeechOnMainThread(String lang) {
        Runnable startTask = () -> {
            stopSpeechOnMainThread();
            requestAudioFocusInternal();
            final int sessionId = ++speechSessionCounter;

            try {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                speechRecognizer.setRecognitionListener(new RecognitionListener() {
                    @Override
                    public void onReadyForSpeech(Bundle params) {
                        // Ready
                    }

                    @Override
                    public void onBeginningOfSpeech() {
                        // Speaking started
                    }

                    @Override
                    public void onRmsChanged(float rmsdB) {
                        // Optional RMS level
                    }

                    @Override
                    public void onBufferReceived(byte[] buffer) {
                        // Unused
                    }

                    @Override
                    public void onEndOfSpeech() {
                        // Wait for results or error
                    }

                    @Override
                    public void onError(int error) {
                        if (!isListening || sessionId != speechSessionCounter) {
                            return;
                        }
                        isListening = false;
                        abandonAudioFocusInternal();
                        if (error == SpeechRecognizer.ERROR_CLIENT) {
                            emitEventIfActive("speechEnd", new JSObject());
                            destroyRecognizerOnMain();
                            return;
                        }
                        String reason;
                        String message;
                        switch (error) {
                            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                                reason = "permission-denied";
                                message = "Microphone access was blocked. Allow microphone permission to practice speaking.";
                                break;
                            case SpeechRecognizer.ERROR_NO_MATCH:
                            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                                reason = "no-speech";
                                message = "No speech detected — tap the mic and speak clearly.";
                                break;
                            case SpeechRecognizer.ERROR_AUDIO:
                                reason = "audio-capture";
                                message = "Could not capture audio from the device microphone.";
                                break;
                            case SpeechRecognizer.ERROR_NETWORK:
                            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                            case SpeechRecognizer.ERROR_SERVER:
                                reason = "network";
                                message = "Speech recognition needs a network connection on this device.";
                                break;
                            default:
                                reason = "unknown";
                                message = "Could not process speech. Please try again.";
                                break;
                        }
                        emitSpeechError(reason, message);
                        emitEventIfActive("speechEnd", new JSObject());
                        destroyRecognizerOnMain();
                    }

                    @Override
                    public void onResults(Bundle results) {
                        if (!isListening || sessionId != speechSessionCounter) {
                            return;
                        }
                        isListening = false;
                        abandonAudioFocusInternal();
                        ArrayList<String> matches = results != null
                            ? results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            : null;
                        JSArray candidates = new JSArray();
                        if (matches != null) {
                            for (String item : matches) {
                                if (item != null && !item.trim().isEmpty()) {
                                    candidates.put(item.trim());
                                }
                            }
                        }
                        JSObject payload = new JSObject();
                        payload.put("candidates", candidates);
                        emitEventIfActive("speechResults", payload);
                        emitEventIfActive("speechEnd", new JSObject());
                        destroyRecognizerOnMain();
                    }

                    @Override
                    public void onPartialResults(Bundle partialResults) {
                        if (!isListening || sessionId != speechSessionCounter) {
                            return;
                        }
                        ArrayList<String> matches = partialResults != null
                            ? partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            : null;
                        if (matches != null && !matches.isEmpty()) {
                            String first = matches.get(0);
                            if (first != null && !first.trim().isEmpty()) {
                                JSObject payload = new JSObject();
                                payload.put("transcript", first.trim());
                                emitEventIfActive("speechPartial", payload);
                            }
                        }
                    }

                    @Override
                    public void onEvent(int eventType, Bundle params) {
                        // Unused
                    }
                });

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);

                isListening = true;
                speechRecognizer.startListening(intent);
            } catch (Exception ex) {
                isListening = false;
                abandonAudioFocusInternal();
                emitSpeechError("unknown", "Unable to start Android speech recognition.");
                emitEventIfActive("speechEnd", new JSObject());
                destroyRecognizerOnMain();
            }
        };

        if (Looper.myLooper() == Looper.getMainLooper()) {
            startTask.run();
        } else {
            bridge.executeOnMainThread(startTask);
        }
    }

    @PluginMethod
    public void stopSpeechRecognition(PluginCall call) {
        stopSpeechInternal();
        call.resolve();
    }

    private void stopSpeechInternal() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            stopSpeechOnMainThread();
            return;
        }
        if (bridge != null) {
            bridge.executeOnMainThread(this::stopSpeechOnMainThread);
        }
    }

    private void stopSpeechOnMainThread() {
        boolean wasListening = isListening;
        isListening = false;
        speechSessionCounter++;
        if (speechRecognizer != null) {
            try {
                speechRecognizer.cancel();
            } catch (Exception ignored) {
                // Ignore cancel errors
            }
        }
        destroyRecognizerOnMain();
        abandonAudioFocusInternal();
        if (wasListening) {
            emitEventIfActive("speechEnd", new JSObject());
        }
    }

    private void destroyRecognizerOnMain() {
        if (speechRecognizer != null) {
            try {
                speechRecognizer.destroy();
            } catch (Exception ignored) {
                // Ignore destroy errors
            }
            speechRecognizer = null;
        }
    }

    private void emitSpeechError(String reason, String message) {
        JSObject payload = new JSObject();
        payload.put("reason", reason);
        payload.put("message", message);
        emitEventIfActive("speechError", payload);
    }
}
