import React, { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Shield, AlertTriangle, CheckCircle2, Activity, Volume2, RefreshCw, Lock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { motion, AnimatePresence } from "framer-motion";

export function VoiceActivation({ isListening: externalIsListening, onToggleListening, disabled }) {
  const [hasPermission, setHasPermission] = useState(false);
  const [permissionPromptState, setPermissionPromptState] = useState("unprompted"); // "unprompted" | "granted" | "denied" | "dismissed"
  const [micActive, setMicActive] = useState(false);
  const [statusState, setStatusState] = useState("Standby"); // "Standby" | "Listening..." | "Processing..." | "HELP detected" | "No emergency keyword detected"
  const [predictionResult, setPredictionResult] = useState(null); // { predicted_class, confidence_pct, class_probabilities_pct }
  const [errorMessage, setErrorMessage] = useState("");

  const mediaStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingIntervalRef = useRef(null);
  const isProcessingRef = useRef(false);

  // Clean up MediaStream and recording timers on component unmount
  useEffect(() => {
    return () => {
      stopMicrophoneStream();
    };
  }, []);

  const stopMicrophoneStream = () => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.warn("Error stopping MediaRecorder:", err);
      }
      mediaRecorderRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (err) {
          console.warn("Error stopping MediaStream track:", err);
        }
      });
      mediaStreamRef.current = null;
    }

    setMicActive(false);
    if (externalIsListening && onToggleListening) {
      onToggleListening(false);
    }
  };

  const requestMicrophonePermission = async () => {
    setErrorMessage("");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPermissionPromptState("denied");
      setErrorMessage("Microphone access is not supported by your browser environment.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      setHasPermission(true);
      setPermissionPromptState("granted");
      startVoiceMonitoring(stream);
    } catch (err) {
      console.warn("Microphone permission denied or error:", err);
      setHasPermission(false);
      setPermissionPromptState("denied");
      setErrorMessage("Microphone permission denied or unavailable. Enable microphone access to use voice detection.");
    }
  };

  const handleDismissPermissionPrompt = () => {
    setPermissionPromptState("dismissed");
    setStatusState("Standby");
  };

  const startVoiceMonitoring = (streamToUse = null) => {
    if (disabled) return;
    setErrorMessage("");

    const stream = streamToUse || mediaStreamRef.current;

    if (!stream || !stream.active) {
      void requestMicrophonePermission();
      return;
    }

    setMicActive(true);
    setStatusState("Listening...");

    if (onToggleListening) {
      onToggleListening(true);
    }

    recordAndPredictAudioSlice(stream);

    recordingIntervalRef.current = setInterval(() => {
      if (!isProcessingRef.current) {
        recordAndPredictAudioSlice(stream);
      }
    }, 1500);
  };

  const recordAndPredictAudioSlice = (stream) => {
    if (!stream || !stream.active || isProcessingRef.current) return;

    try {
      let mimeType = "";

      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm";
      } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
        mimeType = "audio/ogg;codecs=opus";
      }

      const options = mimeType ? { mimeType } : {};

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      const chunks = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error("[Voice Recorder] MediaRecorder error:", event.error);
      };

      recorder.onstop = async () => {
        if (chunks.length === 0) {
          console.warn("[Voice Recorder] No audio chunks received.");
          return;
        }

        const finalMimeType =
          recorder.mimeType ||
          mimeType ||
          "audio/webm";

        const blob = new Blob(chunks, {
          type: finalMimeType
        });

        console.log(
          `[Voice Recorder] Complete audio sample: ${blob.size} bytes, type=${finalMimeType}`
        );

        if (blob.size < 1000) {
          console.warn(
            `[Voice Recorder] Audio sample too small: ${blob.size} bytes`
          );
          return;
        }

        await sendAudioToBackend(blob);
      };

      recorder.start();

      setStatusState("Listening...");

      // Record slightly longer than exactly 1 second so the container
      // can be finalized cleanly before FFmpeg processes it.
      setTimeout(() => {
        if (recorder.state === "recording") {
          try {
            recorder.stop();
          } catch (error) {
            console.warn(
              "[Voice Recorder] Error stopping recorder:",
              error
            );
          }
        }
      }, 1200);

    } catch (error) {
      console.error(
        "[Voice Recorder] Error initializing MediaRecorder:",
        error
      );

      setErrorMessage("Unable to record audio clip for prediction.");
    }
  };

  const sendAudioToBackend = async (blob) => {
    isProcessingRef.current = true;
    setStatusState("Processing...");

    try {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const response = await fetch("/api/predict-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64Data })
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const result = await response.json();
      if (result.success) {
        setPredictionResult(result);
        if (result.predicted_class === "HELP") {
          setStatusState("HELP detected");
        } else {
          setStatusState("No emergency keyword detected");
        }
      } else {
        setErrorMessage(result.error || "Unable to process audio sample.");
        setStatusState("Standby");
      }
    } catch (err) {
      console.warn("Voice ML API network error:", err);
      setErrorMessage("Unable to connect to backend voice model server.");
    } finally {
      isProcessingRef.current = false;
    }
  };

  const toggleMicrophoneControl = () => {
    if (disabled) return;

    if (micActive) {
      stopMicrophoneStream();
      setStatusState("Standby");
    } else {
      if (hasPermission && mediaStreamRef.current) {
        startVoiceMonitoring(mediaStreamRef.current);
      } else {
        void requestMicrophonePermission();
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* ───────────────────────────────────────────────────────────── */}
      {/* 1. INITIAL PERMISSION EXPLANATION UI (When unprompted or dismissed) */}
      {/* ───────────────────────────────────────────────────────────── */}
      {!hasPermission && (permissionPromptState === "unprompted" || permissionPromptState === "dismissed") && (
        <Card className="border border-blue-200 bg-blue-50/70 p-5 rounded-2xl shadow-sm">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                <Mic className="w-4 h-4" />
              </div>
              <h4 className="text-sm font-black text-slate-900">Enable Voice Detection</h4>
            </div>

            <p className="text-xs font-medium text-slate-600 leading-relaxed">
              Voice detection can recognize emergency keywords such as <strong className="text-slate-900 font-extrabold">HELP</strong> and provide an additional safety signal to SafeStreets. Microphone access is used only while voice detection is active.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                type="button"
                onClick={requestMicrophonePermission}
                disabled={disabled}
                className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-4 py-2 rounded-xl shadow-md transition-colors"
              >
                <Mic className="w-3.5 h-3.5 mr-1.5" />
                Enable Microphone
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleDismissPermissionPrompt}
                className="border-slate-300 text-slate-700 font-bold text-xs px-4 py-2 rounded-xl hover:bg-white"
              >
                Not Now
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 2. DENIED PERMISSION WARNING UI */}
      {/* ───────────────────────────────────────────────────────────── */}
      {permissionPromptState === "denied" && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Microphone Permission Denied / Unavailable</span>
          </div>
          <p className="text-[11px] font-medium text-amber-700 leading-relaxed">
            {errorMessage || "Microphone access is disabled. Please allow microphone access in your browser site settings to enable Voice Detection."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={requestMicrophonePermission}
            className="border-amber-300 text-amber-900 bg-white font-extrabold text-[11px] rounded-xl"
          >
            Retry Permission
          </Button>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 3. ACTIVE MICROPHONE CONTROL & MODEL RESULT CARD */}
      {/* ───────────────────────────────────────────────────────────── */}
      {hasPermission && (
        <Card className={`p-5 rounded-2xl border transition-all ${
          micActive
            ? "bg-slate-900 border-slate-800 text-white shadow-xl"
            : "bg-slate-50 border-slate-200/80 text-slate-900"
        }`}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleMicrophoneControl}
                  disabled={disabled}
                  title={micActive ? "Turn microphone OFF" : "Turn microphone ON"}
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer ${
                    micActive
                      ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 scale-105"
                      : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                  }`}
                >
                  {micActive ? (
                    <Mic className="w-6 h-6 animate-pulse" />
                  ) : (
                    <MicOff className="w-6 h-6" />
                  )}
                </button>

                <div>
                  <h4 className={`text-base font-black tracking-tight ${micActive ? "text-white" : "text-slate-900"}`}>
                    {micActive ? "Voice Monitoring Active" : "Voice Monitoring Standby"}
                  </h4>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${micActive ? "text-emerald-400" : "text-slate-500"}`}>
                    {micActive ? "Real-time PyTorch ML Inference" : "Microphone Inactive"}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                onClick={toggleMicrophoneControl}
                disabled={disabled}
                variant={micActive ? "destructive" : "default"}
                className={`font-black text-xs px-4 py-2 rounded-xl transition-all ${
                  micActive
                    ? "bg-rose-600 hover:bg-rose-700 text-white"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white"
                }`}
              >
                {micActive ? "Turn OFF" : "Turn ON"}
              </Button>
            </div>

            {/* Current Pipeline Status Badge */}
            <div className={`p-3 rounded-xl flex items-center justify-between text-xs font-extrabold ${
              micActive
                ? "bg-white/10 text-slate-200 border border-white/10"
                : "bg-white text-slate-700 border border-slate-200"
            }`}>
              <div className="flex items-center gap-2">
                <Activity className={`w-4 h-4 ${micActive ? "text-emerald-400 animate-spin" : "text-slate-400"}`} />
                <span>Status: {statusState}</span>
              </div>

              {micActive && (
                <span className="flex items-center gap-1.5 text-[10px] font-black uppercase text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                  Stream Active
                </span>
              )}
            </div>

            {/* ───────────────────────────────────────────────────────────── */}
            {/* MODEL PREDICTION RESULTS DISPLAY */}
            {/* ───────────────────────────────────────────────────────────── */}
            {predictionResult && micActive && (
              <AnimatePresence>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-4 rounded-xl space-y-2 border ${
                    predictionResult.predicted_class === "HELP"
                      ? "bg-rose-500/20 border-rose-500/50 text-white"
                      : "bg-white/5 border-white/10 text-slate-200"
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                      Voice Detection
                    </span>
                    <span className="text-[10px] font-bold bg-slate-800 text-emerald-400 px-2 py-0.5 rounded-md">
                      SafeStreetsVoiceNet 2D CNN
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Status</span>
                      <span className={`text-lg font-black ${
                        predictionResult.predicted_class === "HELP" ? "text-rose-400 animate-pulse" : "text-white"
                      }`}>
                        {predictionResult.predicted_class}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Confidence</span>
                      <span className="text-lg font-black text-emerald-400">
                        {predictionResult.confidence_pct.toFixed(2)}%
                      </span>
                    </div>
                  </div>

                  {/* Class Probabilities Distribution Bar */}
                  {predictionResult.class_probabilities_pct && (
                    <div className="pt-2 border-t border-white/10 grid grid-cols-4 gap-1.5 text-[10px] font-extrabold text-slate-400">
                      {Object.entries(predictionResult.class_probabilities_pct).map(([cls, pct]) => (
                        <div key={cls} className="bg-slate-800/80 p-1.5 rounded-lg border border-slate-700 text-center">
                          <span className="block text-[9px] text-slate-400">{cls}</span>
                          <span className="text-white font-bold">{pct.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            )}

            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
