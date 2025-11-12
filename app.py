from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Απλή λογική AI chat
@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json()
    user_message = data.get("message", "")
    
    # Απλή απάντηση βασισμένη στο μήνυμα
    if "hello" in user_message.lower():
        response = "Γεια σου! Πώς μπορώ να σε βοηθήσω;"
    else:
        response = f"AI απάντηση για: {user_message}"
    
    return jsonify({"reply": response})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
