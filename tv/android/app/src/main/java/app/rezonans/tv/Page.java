package app.rezonans.tv;

import android.content.Context;

import java.util.concurrent.CopyOnWriteArraySet;

/**
 * Something that shows the Резонанс OS page: the home screen (MainActivity) or
 * the screen saver the system starts over other apps (Dream). What's playing
 * and the sound for the waves go to whichever is on the screen.
 */
interface Page {
    void emit(String name, String json);

    boolean isVisible();

    Context context();

    /** Every page alive. */
    final class All {
        private static final CopyOnWriteArraySet<Page> pages = new CopyOnWriteArraySet<>();

        private All() {
        }

        static void add(Page p) {
            pages.add(p);
        }

        static void remove(Page p) {
            pages.remove(p);
        }

        static void emit(String name, String json) {
            for (Page p : pages) p.emit(name, json);
        }

        /** The page on the screen now, or null. */
        static Page shown() {
            for (Page p : pages) if (p.isVisible()) return p;
            return null;
        }
    }
}
