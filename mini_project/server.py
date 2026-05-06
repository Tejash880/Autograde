from flask import Flask, render_template, request, jsonify, session, redirect, url_for, Response
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
import random, string, os, io, json, re
from datetime import datetime

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['SECRET_KEY'] = 'secret_key_123'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
db = SQLAlchemy(app)

# ── Lazy model loading ─────────────────────────────────────────────────────────
_models_loaded = False
_grade_answer  = None

def get_grader():
    global _models_loaded, _grade_answer
    if not _models_loaded:
        import models as ml
        _grade_answer  = ml.grade_answer
        _models_loaded = True
    return _grade_answer

# ── Database Models ────────────────────────────────────────────────────────────
class User(db.Model):
    id       = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    role     = db.Column(db.String(10), nullable=False)

class Classroom(db.Model):
    id           = db.Column(db.Integer, primary_key=True)
    name         = db.Column(db.String(100), nullable=False)
    teacher_name = db.Column(db.String(50), nullable=False)
    code         = db.Column(db.String(8), unique=True, nullable=False)
    sections     = db.relationship('Section', backref='classroom', lazy=True, cascade='all,delete-orphan')
    questions    = db.relationship('Question', backref='classroom', lazy=True, cascade='all,delete-orphan')
    enrollments  = db.relationship('Enrollment', backref='classroom', lazy=True, cascade='all,delete-orphan')

class Enrollment(db.Model):
    id           = db.Column(db.Integer, primary_key=True)
    student_name = db.Column(db.String(50), nullable=False)
    class_id     = db.Column(db.Integer, db.ForeignKey('classroom.id'), nullable=False)
    __table_args__ = (db.UniqueConstraint('student_name', 'class_id'),)

class Section(db.Model):
    """A named group of questions within a class (e.g. "Assignment 1")."""
    id           = db.Column(db.Integer, primary_key=True)
    class_id     = db.Column(db.Integer, db.ForeignKey('classroom.id'), nullable=False)
    title        = db.Column(db.String(200), nullable=False)
    deadline     = db.Column(db.DateTime, nullable=True)   # optional ISO datetime
    order        = db.Column(db.Integer, default=0)
    questions    = db.relationship('Question', backref='section', lazy=True, cascade='all,delete-orphan')

class Question(db.Model):
    id         = db.Column(db.Integer, primary_key=True)
    class_id   = db.Column(db.Integer, db.ForeignKey('classroom.id'), nullable=False)
    section_id = db.Column(db.Integer, db.ForeignKey('section.id'), nullable=True)
    text       = db.Column(db.Text, nullable=False)
    ref_answer = db.Column(db.Text, nullable=False)
    max_marks  = db.Column(db.Integer, default=10)
    order      = db.Column(db.Integer, default=0)

class Submission(db.Model):
    id           = db.Column(db.Integer, primary_key=True)
    question_id  = db.Column(db.Integer, db.ForeignKey('question.id'))
    class_id     = db.Column(db.Integer, db.ForeignKey('classroom.id'))
    student_name = db.Column(db.String(50))
    answer       = db.Column(db.Text)
    score        = db.Column(db.Float)
    feedback     = db.Column(db.Text)
    submitted_at = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()

# ── Helpers ────────────────────────────────────────────────────────────────────
def generate_code():
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if not Classroom.query.filter_by(code=code).first():
            return code

def extract_pdf_text(file_bytes):
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        return '\n'.join(page.extract_text() or '' for page in reader.pages).strip()
    except Exception:
        return None

def logged_in():
    return 'user' in session

def parse_multi_answer_pdf(text):
    pattern = r'(?i)question\s*(\d+)\s*(?:answer)?\s*[:\-]'
    parts = re.split(pattern, text)
    # parts = [preamble, num, answer_text, num, answer_text, ...]
    results = {}
    for i in range(1, len(parts) - 1, 2):
        num = int(parts[i])
        answer = parts[i + 1].strip()
        if answer:
            results[num] = answer
    if not results:
        return [{"num": 1, "answer": text.strip()}]
    return [{"num": k, "answer": v} for k, v in sorted(results.items())]

def parse_multi_qa_pdf(text):
    pattern = r'(?i)question\s*(\d+)\s*[:\-]'
    parts = re.split(pattern, text)
    # parts = [preamble, num, chunk, num, chunk, ...]
    if len(parts) < 3:
        blocks = [b.strip() for b in re.split(r'\n\s*\n', text) if b.strip()]
        pairs = []
        for b in blocks:
            lines = b.split('\n')
            if len(lines) >= 2:
                pairs.append({"question": lines[0].strip(), "ref_answer": '\n'.join(lines[1:]).strip()})
            else:
                pairs.append({"question": b, "ref_answer": ""})
        return pairs

    results = []
    ans_pattern = r'(?i)answer\s*\d+\s*[:\-]'
    for i in range(1, len(parts) - 1, 2):
        chunk = parts[i + 1]
        ans_parts = re.split(ans_pattern, chunk, maxsplit=1)
        q_text  = ans_parts[0].strip()
        ref_ans = ans_parts[1].strip() if len(ans_parts) > 1 else ''
        if q_text:
            results.append({"question": q_text, "ref_answer": ref_ans})
    return results

def section_to_dict(s):
    return {
        "id":       s.id,
        "title":    s.title,
        "deadline": s.deadline.isoformat() if s.deadline else None,
        "order":    s.order,
        "question_count": len(s.questions)
    }

def question_to_dict(q):
    return {
        "id":         q.id,
        "text":       q.text,
        "max_marks":  q.max_marks,
        "section_id": q.section_id,
        "order":      q.order
    }

# ── Pages ──────────────────────────────────────────────────────────────────────
@app.route('/')
def root():
    return redirect(url_for('home_page') if logged_in() else url_for('login_page'))

@app.route('/login')
def login_page():
    return redirect(url_for('home_page')) if logged_in() else render_template('login.html')

@app.route('/home')
def home_page():
    return render_template('home.html') if logged_in() else redirect(url_for('login_page'))

# ── Auth API ───────────────────────────────────────────────────────────────────
@app.route('/api/register', methods=['POST'])
def register():
    data     = request.json
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    role     = data.get('role', 'student')
    if not username or not password:
        return jsonify({"err": "Username and password required"}), 400
    if len(password) < 4:
        return jsonify({"err": "Password must be at least 4 characters"}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"err": "Username already taken"}), 409
    user = User(username=username, password=generate_password_hash(password), role=role)
    db.session.add(user)
    db.session.commit()
    session['user'] = username
    session['role'] = role
    return jsonify({"status": "ok", "role": role})

@app.route('/api/login', methods=['POST'])
def api_login():
    data     = request.json
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    user     = User.query.filter_by(username=username).first()
    if not user or not check_password_hash(user.password, password):
        return jsonify({"err": "Invalid username or password"}), 401
    session['user'] = user.username
    session['role'] = user.role
    return jsonify({"status": "ok", "role": user.role})

@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({"status": "ok"})

@app.route('/api/me')
def api_me():
    if not logged_in():
        return jsonify({"err": "Not logged in"}), 401
    return jsonify({"username": session['user'], "role": session['role']})

# ── Classes ────────────────────────────────────────────────────────────────────
@app.route('/api/classes', methods=['GET', 'POST'])
def handle_classes():
    if not logged_in():
        return jsonify({"err": "Unauthorized"}), 401
    if request.method == 'POST':
        if session['role'] != 'teacher':
            return jsonify({"err": "Only teachers can create classes"}), 403
        name = (request.json.get('name') or '').strip()
        if not name:
            return jsonify({"err": "Class name required"}), 400
        cls = Classroom(name=name, teacher_name=session['user'], code=generate_code())
        db.session.add(cls)
        db.session.commit()
        return jsonify({"id": cls.id, "name": cls.name, "code": cls.code,
                        "teacher_name": cls.teacher_name, "question_count": 0})
    if session['role'] == 'teacher':
        classes = Classroom.query.filter_by(teacher_name=session['user']).all()
    else:
        eids    = [e.class_id for e in Enrollment.query.filter_by(student_name=session['user']).all()]
        classes = Classroom.query.filter(Classroom.id.in_(eids)).all()
    return jsonify([{"id": c.id, "name": c.name, "teacher_name": c.teacher_name,
                     "code": c.code, "question_count": len(c.questions)} for c in classes])

@app.route('/api/classes/join', methods=['POST'])
def join_class():
    if not logged_in() or session['role'] != 'student':
        return jsonify({"err": "Only students can join classes"}), 403
    code = (request.json.get('code') or '').strip().upper()
    if not code:
        return jsonify({"err": "Enter a join code"}), 400
    cls = Classroom.query.filter_by(code=code).first()
    if not cls:
        return jsonify({"err": "Invalid code — no class found"}), 404
    if Enrollment.query.filter_by(student_name=session['user'], class_id=cls.id).first():
        return jsonify({"err": "You're already enrolled in this class"}), 409
    db.session.add(Enrollment(student_name=session['user'], class_id=cls.id))
    db.session.commit()
    return jsonify({"id": cls.id, "name": cls.name, "teacher_name": cls.teacher_name,
                    "code": cls.code, "question_count": len(cls.questions)})

# ── Sections ───────────────────────────────────────────────────────────────────
@app.route('/api/classes/<int:class_id>/sections', methods=['GET', 'POST'])
def handle_sections(class_id):
    if not logged_in():
        return jsonify({"err": "Unauthorized"}), 401
    cls = Classroom.query.get_or_404(class_id)
    if request.method == 'POST':
        if session['role'] != 'teacher' or cls.teacher_name != session['user']:
            return jsonify({"err": "Forbidden"}), 403
        data     = request.json
        title    = (data.get('title') or '').strip()
        deadline = data.get('deadline')  # ISO string or None
        if not title:
            return jsonify({"err": "Section title required"}), 400
        dl = None
        if deadline:
            try:
                dl = datetime.fromisoformat(deadline.replace('Z', '+00:00').replace('+00:00',''))
            except Exception:
                return jsonify({"err": "Invalid deadline format"}), 400
        max_order = db.session.query(db.func.max(Section.order)).filter_by(class_id=class_id).scalar() or 0
        sec = Section(class_id=class_id, title=title, deadline=dl, order=max_order+1)
        db.session.add(sec)
        db.session.commit()
        return jsonify(section_to_dict(sec))
    sections = Section.query.filter_by(class_id=class_id).order_by(Section.order).all()
    return jsonify([section_to_dict(s) for s in sections])

@app.route('/api/classes/<int:class_id>/sections/<int:sec_id>', methods=['PUT', 'DELETE'])
def update_section(class_id, sec_id):
    if not logged_in(): return jsonify({"err": "Unauthorized"}), 401
    cls = Classroom.query.get_or_404(class_id)
    if session['role'] != 'teacher' or cls.teacher_name != session['user']:
        return jsonify({"err": "Forbidden"}), 403
    sec = Section.query.get_or_404(sec_id)
    if request.method == 'DELETE':
        db.session.delete(sec)
        db.session.commit()
        return jsonify({"msg": "Deleted"})
    data  = request.json
    title = (data.get('title') or '').strip()
    if title: sec.title = title
    deadline = data.get('deadline')
    if deadline == '' or deadline is None:
        sec.deadline = None
    elif deadline:
        try:
            sec.deadline = datetime.fromisoformat(deadline.replace('Z','+00:00').replace('+00:00',''))
        except Exception:
            return jsonify({"err": "Invalid deadline format"}), 400
    db.session.commit()
    return jsonify(section_to_dict(sec))

# ── Questions ──────────────────────────────────────────────────────────────────
@app.route('/api/classes/<int:class_id>/questions', methods=['GET', 'POST'])
def handle_questions(class_id):
    if not logged_in():
        return jsonify({"err": "Unauthorized"}), 401
    cls = Classroom.query.get_or_404(class_id)
    if request.method == 'POST':
        if session['role'] != 'teacher' or cls.teacher_name != session['user']:
            return jsonify({"err": "Forbidden"}), 403
        data       = request.json
        text       = (data.get('text') or '').strip()
        ref_answer = (data.get('ref_answer') or '').strip()
        section_id = data.get('section_id')
        if not text or not ref_answer:
            return jsonify({"err": "Both fields required"}), 400
        # Validate section belongs to class
        if section_id:
            sec = Section.query.get(section_id)
            if not sec or sec.class_id != class_id:
                return jsonify({"err": "Invalid section"}), 400
        max_order = db.session.query(db.func.max(Question.order)).filter_by(class_id=class_id).scalar() or 0
        q = Question(class_id=class_id, text=text, ref_answer=ref_answer, section_id=section_id, order=max_order+1)
        db.session.add(q)
        db.session.commit()
        return jsonify(question_to_dict(q))
    # GET — include submission status for students
    questions = Question.query.filter_by(class_id=class_id).order_by(Question.section_id.nullslast(), Question.order).all()
    if session['role'] == 'student':
        submitted_ids = {s.question_id for s in Submission.query.filter_by(
            class_id=class_id, student_name=session['user']).all()}
        return jsonify([{**question_to_dict(q), "submitted": q.id in submitted_ids} for q in questions])
    return jsonify([question_to_dict(q) for q in questions])

@app.route('/api/classes/<int:class_id>/questions/bulk', methods=['POST'])
def bulk_add_questions(class_id):
    if not logged_in(): return jsonify({"err": "Unauthorized"}), 401
    cls = Classroom.query.get_or_404(class_id)
    if session['role'] != 'teacher' or cls.teacher_name != session['user']:
        return jsonify({"err": "Forbidden"}), 403
    items = request.json.get('questions', [])
    if not items or not isinstance(items, list):
        return jsonify({"err": "No questions provided"}), 400
    if len(items) > 50:
        return jsonify({"err": "Maximum 50 questions per bulk upload"}), 400
    section_id = request.json.get('section_id')
    if section_id:
        sec = Section.query.get(section_id)
        if not sec or sec.class_id != class_id:
            return jsonify({"err": "Invalid section"}), 400
    results = []; added = 0; to_add = []
    max_order = db.session.query(db.func.max(Question.order)).filter_by(class_id=class_id).scalar() or 0
    for i, item in enumerate(items):
        text       = (item.get('text') or '').strip()
        ref_answer = (item.get('ref_answer') or '').strip()
        slot       = item.get('slot', i+1)
        if not text and not ref_answer:
            results.append({"slot": slot, "status": "skipped", "reason": "empty"}); continue
        if not text:
            results.append({"slot": slot, "status": "error", "reason": "Missing question text"}); continue
        if not ref_answer:
            results.append({"slot": slot, "status": "error", "reason": "Missing reference answer"}); continue
        max_order += 1
        q = Question(class_id=class_id, text=text, ref_answer=ref_answer, section_id=section_id, order=max_order)
        to_add.append((slot, q))
    try:
        for _, q in to_add: db.session.add(q)
        db.session.commit()
        for slot, q in to_add:
            results.append({"slot": slot, "status": "ok", "id": q.id, "text": q.text}); added += 1
    except Exception as e:
        db.session.rollback()
        return jsonify({"err": f"Database error: {str(e)}"}), 500
    results.sort(key=lambda r: r['slot'])
    return jsonify({"added": added, "total": len(items), "results": results})

@app.route('/api/classes/<int:class_id>/questions/<int:q_id>', methods=['DELETE'])
def delete_question(class_id, q_id):
    if not logged_in() or session['role'] != 'teacher': return jsonify({"err": "Unauthorized"}), 403
    cls = Classroom.query.get_or_404(class_id)
    if cls.teacher_name != session['user']: return jsonify({"err": "Forbidden"}), 403
    q = Question.query.get_or_404(q_id)
    db.session.delete(q); db.session.commit()
    return jsonify({"msg": "Deleted"})

# ── PDF extraction ─────────────────────────────────────────────────────────────
@app.route('/api/extract-pdf', methods=['POST'])
def extract_pdf():
    if not logged_in(): return jsonify({"err": "Unauthorized"}), 401
    if 'file' not in request.files: return jsonify({"err": "No file uploaded"}), 400
    f = request.files['file']
    if not f.filename.lower().endswith('.pdf'): return jsonify({"err": "Only PDF files are supported"}), 400
    text = extract_pdf_text(f.read())
    if text is None: return jsonify({"err": "Could not extract text from PDF"}), 422
    if not text: return jsonify({"err": "PDF appears to be empty or image-only"}), 422
    return jsonify({"text": text})

@app.route('/api/extract-pdf/multi-answer', methods=['POST'])
def extract_pdf_multi_answer():
    """Extract and split a student PDF into multiple answers by question."""
    if not logged_in(): return jsonify({"err": "Unauthorized"}), 401
    if 'file' not in request.files: return jsonify({"err": "No file uploaded"}), 400
    f = request.files['file']
    if not f.filename.lower().endswith('.pdf'): return jsonify({"err": "Only PDF files"}), 400
    text = extract_pdf_text(f.read())
    if not text: return jsonify({"err": "Could not extract text"}), 422
    answers = parse_multi_answer_pdf(text)
    return jsonify({"raw": text, "answers": answers})

@app.route('/api/extract-pdf/multi-qa', methods=['POST'])
def extract_pdf_multi_qa():
    """Extract and split a teacher PDF into Q&A pairs."""
    if not logged_in(): return jsonify({"err": "Unauthorized"}), 401
    if 'file' not in request.files: return jsonify({"err": "No file uploaded"}), 400
    f = request.files['file']
    if not f.filename.lower().endswith('.pdf'): return jsonify({"err": "Only PDF files"}), 400
    text = extract_pdf_text(f.read())
    if not text: return jsonify({"err": "Could not extract text"}), 422
    pairs = parse_multi_qa_pdf(text)
    return jsonify({"raw": text, "pairs": pairs})

# ── Evaluate ───────────────────────────────────────────────────────────────────

import traceback

@app.route('/api/evaluate', methods=['POST'])
def evaluate():
    if not logged_in():
        return jsonify({"err": "Unauthorized"}), 401
    try:
        data = request.json
        # Safety check: Ensure data exists
        if not data or 'question_id' not in data or 'answer' not in data:
            return jsonify({"err": "Missing data"}), 400

        q = Question.query.get_or_404(data['question_id'])
        grader = get_grader()
        
        # 1. AI Grading
        marks, entail, contra, msg = grader(q.ref_answer, data['answer'], q.max_marks)

        # 2. Convert types
        clean_marks = float(marks)
        clean_msg = str(msg)
        user_name = session.get('user') # Use .get() to avoid KeyError

        if not user_name:
            return jsonify({"err": "Session expired"}), 401

        # 3. DB Upsert
        sub = Submission.query.filter_by(question_id=q.id, class_id=q.class_id, student_name=user_name).first()

        if sub:
            sub.answer = data['answer']
            sub.score = clean_marks
            sub.feedback = clean_msg
        else:
            sub = Submission(
                question_id=q.id, 
                class_id=q.class_id,
                student_name=user_name,
                answer=data['answer'], 
                score=clean_marks, 
                feedback=clean_msg
            )
            db.session.add(sub)

        db.session.commit()
        return jsonify({"score": clean_marks, "max_marks": q.max_marks, "feedback": clean_msg})

    except Exception as e:
        db.session.rollback()
        # This prints the EXACT error and line number to your Python terminal
        print("--- CRITICAL SERVER ERROR ---")
        print(traceback.format_exc()) 
        return jsonify({"err": str(e)}), 500
@app.route('/api/evaluate/batch', methods=['POST'])
def evaluate_batch():
    if not logged_in(): return jsonify({"err": "Unauthorized"}), 401
    data        = request.json
    submissions = data.get('submissions', [])
    if not submissions: return jsonify({"err": "No submissions"}), 400
    grader = get_grader()

    def generate():
        yield f"data: {json.dumps({'type':'start','total':len(submissions)})}\n\n"
        for idx, sub_data in enumerate(submissions):
            q = Question.query.get(sub_data['question_id'])
            if not q: continue
            marks, _, _, msg = grader(q.ref_answer, sub_data['answer'], q.max_marks)
            sub = Submission(question_id=q.id, class_id=q.class_id, student_name=session['user'],
                             answer=sub_data['answer'], score=marks, feedback=msg)
            db.session.add(sub)
            db.session.commit()
            yield f"data: {json.dumps({'type':'result','question_id':q.id,'score':marks,'max_marks':q.max_marks,'feedback':msg})}\n\n"
        yield f"data: {json.dumps({'type':'done'})}\n\n"

    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})

# ── Submissions ────────────────────────────────────────────────────────────────
@app.route('/api/classes/<int:class_id>/submissions', methods=['GET'])
def get_submissions(class_id):
    if not logged_in() or session['role'] != 'teacher': return jsonify({"err": "Unauthorized"}), 403
    cls = Classroom.query.get_or_404(class_id)
    if cls.teacher_name != session['user']: return jsonify({"err": "Forbidden"}), 403
    subs  = Submission.query.filter_by(class_id=class_id).order_by(Submission.id.desc()).all()
    q_map = {q.id: q for q in cls.questions}
    return jsonify([{
        "id":            s.id,
        "question_id":   s.question_id,
        "question_text": q_map[s.question_id].text if s.question_id in q_map else "—",
        "section_id":    q_map[s.question_id].section_id if s.question_id in q_map else None,
        "student_name":  s.student_name,
        "answer":        s.answer,
        "score":         s.score,
        "max_marks":     q_map[s.question_id].max_marks if s.question_id in q_map else 10,
        "feedback":      s.feedback,
        "submitted_at":  s.submitted_at.isoformat() if s.submitted_at else None
    } for s in subs])

# ── Student grade history ─────────────────────────────────────────────────────
@app.route('/api/my-grades', methods=['GET'])
def my_grades():
    if not logged_in() or session['role'] != 'student':
        return jsonify({"err": "Unauthorized"}), 403
    subs = Submission.query.filter_by(student_name=session['user']).order_by(Submission.submitted_at.desc()).all()
    results = []
    for s in subs:
        q   = Question.query.get(s.question_id)
        cls = Classroom.query.get(s.class_id)
        results.append({
            "id":           s.id,
            "class_name":   cls.name if cls else "—",
            "class_id":     s.class_id,
            "question_text": q.text[:120] if q else "—",
            "score":        s.score,
            "max_marks":    q.max_marks if q else 10,
            "feedback":     s.feedback,
            "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None
        })
    return jsonify(results)

# ── Analytics ─────────────────────────────────────────────────────────────────
@app.route('/api/classes/<int:class_id>/analytics', methods=['GET'])
def get_analytics(class_id):
    if not logged_in() or session['role'] != 'teacher': return jsonify({"err": "Unauthorized"}), 403
    cls = Classroom.query.get_or_404(class_id)
    if cls.teacher_name != session['user']: return jsonify({"err": "Forbidden"}), 403

    questions    = Question.query.filter_by(class_id=class_id).all()
    sections     = Section.query.filter_by(class_id=class_id).order_by(Section.order).all()
    enrollments  = Enrollment.query.filter_by(class_id=class_id).all()
    submissions  = Submission.query.filter_by(class_id=class_id).all()
    q_map        = {q.id: q for q in questions}
    sec_map      = {s.id: s for s in sections}
    total_students = len(enrollments)

    # Per-student stats
    student_scores = {}
    for s in submissions:
        if s.student_name not in student_scores:
            student_scores[s.student_name] = {"total": 0, "max": 0, "count": 0}
        q = q_map.get(s.question_id)
        if q:
            student_scores[s.student_name]["total"] += s.score
            student_scores[s.student_name]["max"]   += q.max_marks
            student_scores[s.student_name]["count"] += 1

    leaderboard = sorted([
        {"name": name, "pct": round(v["total"]/v["max"]*100,1) if v["max"]>0 else 0,
         "total": v["total"], "max": v["max"], "count": v["count"]}
        for name, v in student_scores.items()
    ], key=lambda x: -x["pct"])

    # Per-question stats
    q_stats = {}
    for s in submissions:
        qid = s.question_id
        if qid not in q_stats: q_stats[qid] = {"scores": [], "q": q_map.get(qid)}
        q_stats[qid]["scores"].append(s.score)
    question_stats = []
    for qid, v in q_stats.items():
        q = v["q"]
        if not q: continue
        scores = v["scores"]
        avg    = round(sum(scores)/len(scores), 2) if scores else 0
        question_stats.append({
            "id":        qid,
            "text":      q.text[:80],
            "max_marks": q.max_marks,
            "avg":       avg,
            "pct":       round(avg/q.max_marks*100, 1) if q.max_marks else 0,
            "count":     len(scores),
            "section_title": sec_map[q.section_id].title if q.section_id and q.section_id in sec_map else None
        })

    # Per-section stats
    section_stats = []
    for sec in sections:
        sec_qs = [q for q in questions if q.section_id == sec.id]
        sec_subs = [s for s in submissions if s.question_id in {q.id for q in sec_qs}]
        total = sum(s.score for s in sec_subs)
        max_p = sum(q_map[s.question_id].max_marks for s in sec_subs if s.question_id in q_map)
        section_stats.append({
            "id":    sec.id,
            "title": sec.title,
            "pct":   round(total/max_p*100, 1) if max_p else 0,
            "submissions": len(sec_subs)
        })

    # Score distribution buckets (0-2, 3-4, 5-6, 7-8, 9-10 normalized to /10)
    buckets = [0, 0, 0, 0, 0]  # 0-20%, 21-40%, 41-60%, 61-80%, 81-100%
    for s in submissions:
        q = q_map.get(s.question_id)
        if q and q.max_marks:
            pct = s.score / q.max_marks
            idx = min(int(pct * 5), 4)
            buckets[idx] += 1

    # Submission rate per question
    submitted_by_q = {}
    for s in submissions:
        submitted_by_q[s.question_id] = submitted_by_q.get(s.question_id, set())
        submitted_by_q[s.question_id].add(s.student_name)

    all_scores  = [s.score for s in submissions]
    all_max     = [q_map[s.question_id].max_marks for s in submissions if s.question_id in q_map]
    overall_avg = round(sum(all_scores)/len(all_scores), 2) if all_scores else 0
    overall_pct = round(sum(all_scores)/sum(all_max)*100, 1) if all_max else 0

    return jsonify({
        "total_students":    total_students,
        "total_submissions": len(submissions),
        "total_questions":   len(questions),
        "overall_avg_score": overall_avg,
        "overall_pct":       overall_pct,
        "leaderboard":       leaderboard[:20],
        "question_stats":    sorted(question_stats, key=lambda x: x["pct"]),
        "section_stats":     section_stats,
        "score_distribution": buckets,
        "dist_labels":       ["0–20%","21–40%","41–60%","61–80%","81–100%"]
    })

if __name__ == '__main__':
    app.run(debug=True, threaded=False)