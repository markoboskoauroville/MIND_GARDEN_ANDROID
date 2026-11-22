package app.mindgarden;

import android.content.Context;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;

import java.util.Locale;

/** Speaks short free texts (the welcome with the person's name) with the phone's own voice, in the app's language. */
public class Tts {
    private TextToSpeech tts;
    private boolean ready;
    private String pendingText, pendingLang;

    Tts(Context ctx) {
        tts = new TextToSpeech(ctx.getApplicationContext(), status -> {
            ready = status == TextToSpeech.SUCCESS;
            if (ready && pendingText != null) { speak(pendingText, pendingLang); pendingText = null; }
        });
    }

    /** Returns false when the phone has no voice for that language (then nothing is said). */
    @JavascriptInterface public boolean speak(String text, String lang) {
        if (tts == null) return false;
        if (!ready) { pendingText = text; pendingLang = lang; return true; }
        int r = tts.setLanguage(Locale.forLanguageTag(lang));
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) return false;
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "welcome");
        return true;
    }

    void shutdown() { if (tts != null) { tts.stop(); tts.shutdown(); tts = null; } }
}
