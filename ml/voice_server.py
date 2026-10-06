from flask import Flask, request, jsonify
import os

app = Flask(__name__)

UPLOAD_FOLDER = "received_audio"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route("/predict", methods=["POST"])
def predict():

    # Check whether ESP32 sent the audio field
    if "audio" not in request.files:
        return jsonify({
            "success": False,
            "error": "No audio file received"
        }), 400

    audio = request.files["audio"]

    # Save received WAV
    filepath = os.path.join(
        UPLOAD_FOLDER,
        "received_voice.wav"
    )

    audio.save(filepath)

    print()
    print("================================")
    print("VOICE RECEIVED")
    print("================================")
    print("Saved:", filepath)

    # ==================================================
    # TEMPORARY TEST
    # ==================================================
    #
    # Replace this section with your friend's
    # actual model prediction code.
    #

    predicted_class = "TEST"

    confidence = 0.0

    print("Prediction:", predicted_class)
    print("Confidence:", confidence)

    return jsonify({
        "success": True,
        "predicted_class": predicted_class,
        "confidence_pct": confidence
    })


if __name__ == "__main__":

    print("================================")
    print(" SafeStreets Voice Model Server")
    print("================================")

    print("Starting server...")
    print("Listening on port 5000")

    app.run(
        host="0.0.0.0",
        port=3000,
        debug=False
    )