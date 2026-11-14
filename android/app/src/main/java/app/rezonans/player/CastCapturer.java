package app.rezonans.player;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.view.Surface;

import org.webrtc.CapturerObserver;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.ThreadUtils;
import org.webrtc.VideoCapturer;
import org.webrtc.VideoFrame;
import org.webrtc.VideoSink;

/**
 * The phone's screen for WebRTC — like the library's ScreenCapturerAndroid, but
 * a turn of the phone resizes the one virtual display instead of making a new
 * one: Android 14+ allows a single capture per permission, and the library's
 * way stopped the showing as soon as a video went full screen.
 */
final class CastCapturer implements VideoCapturer, VideoSink {
    private static final int DPI = 400;
    private static final int FLAGS = DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC | DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION;

    private final Intent permission;
    private final MediaProjection.Callback callback;
    private SurfaceTextureHelper helper;
    private CapturerObserver observer;
    private MediaProjectionManager manager;
    private MediaProjection projection;
    private VirtualDisplay display;
    private Surface surface;
    private int width, height;

    CastCapturer(Intent permission, MediaProjection.Callback callback) {
        this.permission = permission;
        this.callback = callback;
    }

    MediaProjection projection() {
        return projection;
    }

    @Override
    public synchronized void initialize(SurfaceTextureHelper h, Context ctx, CapturerObserver o) {
        helper = h;
        observer = o;
        manager = (MediaProjectionManager) ctx.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
    }

    @Override
    public synchronized void startCapture(int w, int h, int ignoredFps) {
        width = w;
        height = h;
        projection = manager.getMediaProjection(Activity.RESULT_OK, permission);
        // Android 14+: the callback before the virtual display
        projection.registerCallback(callback, helper.getHandler());
        helper.setTextureSize(width, height);
        surface = new Surface(helper.getSurfaceTexture());
        display = projection.createVirtualDisplay("Rezonans-Connect", width, height, DPI, FLAGS, surface, null, null);
        observer.onCapturerStarted(true);
        helper.startListening(this);
    }

    @Override
    public synchronized void changeCaptureFormat(final int w, final int h, int ignoredFps) {
        width = w;
        height = h;
        if (display == null) return;
        ThreadUtils.invokeAtFrontUninterruptibly(helper.getHandler(), () -> {
            helper.setTextureSize(width, height);
            display.resize(width, height, DPI);
        });
    }

    @Override
    public synchronized void stopCapture() {
        if (helper == null) return;
        ThreadUtils.invokeAtFrontUninterruptibly(helper.getHandler(), () -> {
            helper.stopListening();
            observer.onCapturerStopped();
            if (display != null) {
                display.release();
                display = null;
            }
            if (surface != null) {
                surface.release();
                surface = null;
            }
            if (projection != null) {
                projection.unregisterCallback(callback);
                projection.stop();
                projection = null;
            }
        });
    }

    @Override
    public void dispose() {
    }

    @Override
    public boolean isScreencast() {
        return true;
    }

    @Override
    public void onFrame(VideoFrame frame) {
        observer.onFrameCaptured(frame);
    }
}
