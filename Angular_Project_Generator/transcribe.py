# Test Code for Openai whisper - need to check other base models like small and medium next!!

import sys
import whisper

def transcribe_audio(file_path):
    model = whisper.load_model("base")  # You can use "tiny", "base", "small", "medium", or "large"
    result = model.transcribe(file_path)
    return result["text"]

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <audio_file_path>")
        sys.exit(1)

    audio_file_path = sys.argv[1]
    try:
        transcription = transcribe_audio(audio_file_path)
        print(transcription)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
