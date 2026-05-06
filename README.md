# AutoGrade — AI-Powered Answer Evaluation System

<div align="center">

![AutoGrade Banner](https://img.shields.io/badge/AutoGrade-AI%20Powered-darkred?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.10+-blue?style=for-the-badge&logo=python)
![Flask](https://img.shields.io/badge/Flask-3.0-black?style=for-the-badge&logo=flask)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-green?style=for-the-badge&logo=postgresql)
![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?style=for-the-badge&logo=vercel)

**An intelligent, NLP-powered answer evaluation platform built for academic institutions.**  
Developed for Gokaraju Rangaraju Institute of Engineering and Technology (GRIET), Hyderabad.

[🌐 Live Demo](https://autograde-n1lv.vercel.app) · [🤖 ML Service](https://tejash9-autograde-ml.hf.space) · [📖 Documentation](#documentation)

</div>

---

## 📋 Table of Contents

- [About the Project](#about-the-project)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [How AI Grading Works](#how-ai-grading-works)
- [Project Structure](#project-structure)
- [Deployment Guide](#deployment-guide)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Screenshots](#screenshots)
- [Acknowledgements](#acknowledgements)

---

## 🎓 About the Project

AutoGrade is a full-stack web application designed to automate the evaluation of descriptive student answers using cutting-edge Natural Language Processing (NLP) techniques. Traditional manual grading is time-consuming, inconsistent, and prone to bias. AutoGrade solves this by leveraging semantic understanding, factual consistency checking, and multiple similarity metrics to produce accurate, explainable scores.

The system is designed for real classroom use — teachers can create classrooms, organize assignments into sections, set deadlines, and view detailed analytics. Students can submit answers, receive instant AI-generated feedback, and track their performance over time.

### 🎯 Problem Statement

Manual grading of descriptive answers in engineering colleges is:
- Time-consuming for faculty with large student batches
- Inconsistent across different evaluators
- Delayed — students don't get immediate feedback
- Difficult to scale for online examinations

### 💡 Solution

AutoGrade provides:
- Instant AI grading with explainable feedback
- Consistent scoring based on semantic understanding
- A complete classroom management ecosystem
- Detailed analytics for teachers and students

---

## ✨ Key Features

### 👩‍🏫 For Teachers
- **Classroom Creation** — Create virtual classrooms with unique join codes
- **Assignment Management** — Organize questions into named sections with optional deadlines
- **PDF Upload** — Upload entire question papers and answer keys as PDFs
- **Batch Grading** — Grade all student submissions for a section at once
- **Analytics Dashboard** — View leaderboards, score distributions, per-question performance
- **Submission Review** — Browse all student answers with scores and feedback

### 👨‍🎓 For Students
- **Easy Enrollment** — Join classrooms using a 6-character code
- **Answer Submission** — Submit answers question by question or upload a PDF
- **Instant Feedback** — Receive AI-generated score and feedback immediately
- **Grade History** — Track performance across all classes and assignments
- **Section View** — See assignments organized by section with deadlines

### 🤖 AI Capabilities
- **Semantic Similarity** — Deep contextual understanding using Universal Sentence Encoder
- **Factual Consistency** — Entailment/contradiction detection using DeBERTa NLI
- **Multi-metric Scoring** — Combination of 5 different similarity metrics
- **Contradiction Penalty** — Automatic zero score for factually incorrect answers
- **Entailment Bonus** — Score boost for highly precise, logically consistent answers

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT BROWSER                        │
│              login.html / home.html / script.js              │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP Requests
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    VERCEL (Main App)                         │
│                      server.py (Flask)                       │
│                                                             │
│   /api/register    /api/login    /api/classes               │
│   /api/questions   /api/submit   /api/analytics             │
└──────────┬──────────────────────────┬───────────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────┐      ┌──────────────────────────────────┐
│   NEON POSTGRES  │      │   HUGGING FACE SPACES (ML)       │
│   (Database)     │      │         app.py (Flask)           │
│                  │      │                                  │
│   Users          │      │   POST /grade                    │
│   Classrooms     │      │                                  │
│   Questions      │      │   • Universal Sentence Encoder   │
│   Submissions    │      │   • DeBERTa NLI CrossEncoder     │
│   Enrollments    │      │   • TF-IDF, Jaccard, Edit Dist   │
└──────────────────┘      └──────────────────────────────────┘
```

---

## 🛠️ Tech Stack

### Backend
| Technology | Purpose | Version |
|---|---|---|
| Python | Core language | 3.10+ |
| Flask | Web framework | 3.0 |
| SQLAlchemy | ORM | 2.0 |
| Werkzeug | Password hashing | 3.0 |
| pypdf | PDF text extraction | 4.0 |
| psycopg2 | PostgreSQL driver | 2.9 |

### Machine Learning
| Technology | Purpose |
|---|---|
| TensorFlow Hub | Universal Sentence Encoder (USE) |
| Sentence Transformers | DeBERTa NLI CrossEncoder |
| scikit-learn | TF-IDF Vectorizer, Cosine Similarity |
| NLTK | Tokenization, Stopwords |
| NumPy | Vector operations |

### Frontend
| Technology | Purpose |
|---|---|
| HTML5 | Structure |
| CSS3 | Styling with CSS variables |
| Vanilla JavaScript | Dynamic UI, Fetch API |
| Google Fonts | EB Garamond + Inter typography |

### Infrastructure
| Service | Purpose | Cost |
|---|---|---|
| Vercel | Main Flask app hosting | Free |
| Hugging Face Spaces | ML model hosting | Free |
| Neon | PostgreSQL database | Free |
| GitHub | Version control | Free |

---

## 🤖 How AI Grading Works

AutoGrade uses a multi-metric ensemble approach to evaluate student answers:

### Step 1 — Preprocessing
Both reference and student answers are normalized (lowercased, whitespace cleaned).

### Step 2 — Factual Consistency Check (DeBERTa NLI)
The `cross-encoder/nli-deberta-v3-large` model checks if the student answer is:
- **Entailment** → logically follows from the reference answer
- **Contradiction** → contradicts the reference answer
- **Neutral** → neither confirms nor contradicts

> ⚠️ If contradiction probability > 60%, the answer receives **0 marks** immediately.

### Step 3 — Similarity Metrics

| Metric | Weight | Description |
|---|---|---|
| Semantic Similarity (USE) | **70%** | Deep contextual embedding similarity |
| TF-IDF Cosine Similarity | 10% | N-gram based term frequency similarity |
| Word Length Ratio | 10% | Penalizes overly short answers |
| Jaccard Similarity | 5% | Keyword overlap between answers |
| Edit Distance | 5% | Character-level string similarity |

### Step 4 — Score Calculation
```
base_score = (0.05 × Sj) + (0.05 × Se) + (0.10 × Sc) + (0.10 × Sw) + (0.70 × Stf)
final_marks = base_score × total_marks

if entailment > 0.85:
    final_marks = min(final_marks × 1.10, total_marks)  # 10% bonus
```

### Step 5 — Feedback Generation
- ✅ **Identical answer** → Full marks
- ❌ **Contradiction detected** → 0 marks
- ✅ **Excellent precision and logic** → Entailment > 85%
- ✅ **Factually consistent** → Entailment > 60%
- ⚠️ **Partially consistent** → Lower entailment

---

## 📁 Project Structure

```
mini_project/
│
├── server.py                   # Main Flask application
│   ├── Database Models         # User, Classroom, Section, Question, Submission
│   ├── Auth Routes             # /api/register, /api/login, /api/logout
│   ├── Classroom Routes        # /api/classes CRUD
│   ├── Section Routes          # /api/classes/:id/sections CRUD
│   ├── Question Routes         # /api/classes/:id/questions CRUD
│   ├── Evaluation Routes       # /api/evaluate, /api/evaluate/batch
│   ├── Submission Routes       # /api/classes/:id/submissions
│   └── Analytics Routes        # /api/classes/:id/analytics
│
├── models.py                   # ML grading engine
│   ├── get_embedding()         # USE embeddings with LRU cache
│   ├── semantic_similarity()   # Cosine similarity on embeddings
│   ├── tfidf_cos()            # TF-IDF cosine similarity
│   ├── jaccard()              # Keyword Jaccard similarity
│   ├── edit_sim()             # Edit distance similarity
│   ├── word_ratio()           # Answer length ratio
│   ├── factual_consistency()  # NLI entailment/contradiction
│   └── grade_answer()         # Main grading function
│
├── requirements.txt            # Python dependencies (main app)
├── vercel.json                 # Vercel deployment configuration
│
├── templates/
│   ├── login.html              # Authentication page (login + register)
│   └── home.html               # Main dashboard (teacher + student views)
│
└── static/
    ├── style.css               # Complete stylesheet with CSS variables
    └── script.js               # Frontend logic and API calls
```

---

## 🚀 Deployment Guide

This project is deployed as **two separate services**:

### Service 1 — Main App (Vercel)

1. Push code to GitHub
2. Import repo on [vercel.com](https://vercel.com)
3. Set Root Directory to `mini_project`
4. Add environment variables (see below)
5. Deploy

### Service 2 — ML Models (Hugging Face Spaces)

1. Create a new Space on [huggingface.co](https://huggingface.co)
2. Select **Docker** SDK
3. Upload `models.py`, `app.py`, `requirements.txt`, `Dockerfile`
4. Wait for build (~15 mins)
5. Copy the Space URL and add as `ML_SERVICE_URL` in Vercel

### Database (Neon PostgreSQL)

1. Create free account on [neon.tech](https://neon.tech)
2. Create a new project
3. Copy the connection string
4. Add as `DATABASE_URL` in Vercel

---

## ⚙️ Environment Variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string | `postgresql://user:pass@host/db` |
| `SECRET_KEY` | Flask session encryption key | `my-secret-key-2024` |
| `ML_SERVICE_URL` | Hugging Face Space base URL | `https://username-autograde-ml.hf.space` |

---

## 📡 API Reference

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/register` | Register new user |
| POST | `/api/login` | Login user |
| POST | `/api/logout` | Logout user |
| GET | `/api/me` | Get current user info |

### Classrooms
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/classes` | Get all classes for user |
| POST | `/api/classes` | Create new classroom |
| POST | `/api/classes/join` | Join classroom with code |
| DELETE | `/api/classes/:id` | Delete classroom |

### Questions & Sections
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/classes/:id/sections` | Get all sections |
| POST | `/api/classes/:id/sections` | Create section |
| GET | `/api/classes/:id/questions` | Get all questions |
| POST | `/api/classes/:id/questions` | Add question |
| DELETE | `/api/questions/:id` | Delete question |

### Evaluation
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/evaluate` | Grade single answer |
| POST | `/api/evaluate/batch` | Grade multiple answers (SSE stream) |

### Analytics
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/classes/:id/analytics` | Get class analytics |
| GET | `/api/classes/:id/submissions` | Get all submissions |
| GET | `/api/my-grades` | Get student grade history |

---

## 🙏 Acknowledgements

- [Google Universal Sentence Encoder](https://tfhub.dev/google/universal-sentence-encoder/4) — Semantic embeddings
- [DeBERTa NLI CrossEncoder](https://huggingface.co/cross-encoder/nli-deberta-v3-large) — Factual consistency
- [Neon](https://neon.tech) — Serverless PostgreSQL
- [Vercel](https://vercel.com) — App hosting
- [Hugging Face](https://huggingface.co) — ML model hosting
- GRIET faculty and students for testing and feedback

---

## 👨‍💻 Developed By

**Tejash Hazari**  
Student, Gokaraju Rangaraju Institute of Engineering and Technology  
Hyderabad, Telangana, India — 2026

---

<div align="center">

**AutoGrade · GRIET · Academic Use Only**  
Made with ❤️ for smarter education

</div>
