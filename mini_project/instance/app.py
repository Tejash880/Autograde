from flask import Flask, request, jsonify
from models import grade_answer

app = Flask(__name__)

@app.route('/grade', methods=['POST'])
def grade():
    data = request.json
    score, entail, contra, msg = grade_answer(
        data['ref'], data['stu'], data.get('total', 10)
    )
    return jsonify({
        "score": score,
        "entail": float(entail),
        "contra": float(contra),
        "msg": msg
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=7860)
