package app.rezonans.tv;

import org.json.JSONObject;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Iterator;

/**
 * Резонанс Connect: who may show their screen on this TV. A computer that
 * isn't known yet asks first ("hello"): the TV then shows a 4-digit code for a
 * few minutes, and the computer must send it back with its picture. A right
 * code gives the computer a long random token, so next time it connects
 * without the code. Wrong codes burn the code after a few tries.
 *
 * No Android here (only org.json), so the rules stay simple to reason about.
 */
final class Pairing {
    static final long CODE_LIFE_MS = 3 * 60 * 1000;
    static final int MAX_TRIES = 5;
    static final int MAX_DEVICES = 12;

    private final SecureRandom rnd = new SecureRandom();
    private String code = null;
    private String codeFor = null; // the computer the code was shown for
    private long codeUntil = 0;
    private int tries = 0;

    /** id -> {token, name, at}: the computers that entered a code once. */
    private JSONObject known;

    Pairing(String saved) {
        JSONObject k;
        try {
            k = saved == null || saved.isEmpty() ? new JSONObject() : new JSONObject(saved);
        } catch (Exception e) {
            k = new JSONObject();
        }
        known = k;
    }

    /** What to keep across restarts. */
    synchronized String save() {
        return known.toString();
    }

    synchronized boolean isKnown(String from) {
        return from != null && known.has(from);
    }

    /** A new code for this computer (the old one, if still fresh and for the same computer). */
    synchronized String codeFor(String from, long now) {
        if (code != null && now < codeUntil && from != null && from.equals(codeFor)) return code;
        code = String.format(java.util.Locale.ROOT, "%04d", rnd.nextInt(10000));
        codeFor = from;
        codeUntil = now + CODE_LIFE_MS;
        tries = 0;
        return code;
    }

    synchronized String shownCode(long now) {
        return code != null && now < codeUntil ? code : null;
    }

    synchronized void dropCode() {
        code = null;
        codeFor = null;
        tries = 0;
    }

    /**
     * The code typed on the computer. Right: the code is used up and a token
     * is returned. Wrong or stale: null (too many wrong tries end the code).
     */
    synchronized String tryCode(String from, String name, String typed, long now) {
        if (from == null || from.isEmpty() || typed == null || code == null) return null;
        if (now >= codeUntil) {
            dropCode();
            return null;
        }
        if (!same(code, typed.trim())) {
            if (++tries >= MAX_TRIES) dropCode();
            return null;
        }
        dropCode();
        return remember(from, name, now);
    }

    /** A token given earlier. */
    synchronized boolean tryToken(String from, String token, long now) {
        if (from == null || token == null || token.isEmpty()) return false;
        JSONObject d = known.optJSONObject(from);
        if (d == null || !same(d.optString("token", ""), token)) return false;
        try {
            d.put("at", now);
        } catch (Exception ignored) {
        }
        return true;
    }

    synchronized String nameOf(String from) {
        JSONObject d = from == null ? null : known.optJSONObject(from);
        return d == null ? "" : d.optString("name", "");
    }

    synchronized int count() {
        return known.length();
    }

    /** Forget every computer: each will need the code again. */
    synchronized void forgetAll() {
        known = new JSONObject();
    }

    private String remember(String from, String name, long now) {
        byte[] b = new byte[24];
        rnd.nextBytes(b);
        StringBuilder t = new StringBuilder();
        for (byte x : b) t.append(String.format(java.util.Locale.ROOT, "%02x", x & 0xff));
        try {
            JSONObject d = new JSONObject();
            d.put("token", t.toString());
            d.put("name", name == null ? "" : name.length() > 60 ? name.substring(0, 60) : name);
            d.put("at", now);
            known.put(from, d);
            // too many: the one not seen for longest goes
            while (known.length() > MAX_DEVICES) {
                String oldest = null;
                long at = Long.MAX_VALUE;
                for (Iterator<String> it = known.keys(); it.hasNext();) {
                    String k = it.next();
                    long a = known.optJSONObject(k) != null ? known.optJSONObject(k).optLong("at", 0) : 0;
                    if (a < at && !k.equals(from)) {
                        at = a;
                        oldest = k;
                    }
                }
                if (oldest == null) break;
                known.remove(oldest);
            }
        } catch (Exception ignored) {
        }
        return t.toString();
    }

    // compared in constant time: the answer's timing tells nothing about the secret
    static boolean same(String a, String b) {
        if (a == null || b == null) return false;
        return MessageDigest.isEqual(a.getBytes(java.nio.charset.StandardCharsets.UTF_8), b.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
}
