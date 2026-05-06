import numpy as np
import nltk
import tensorflow_hub as hub
from functools import lru_cache
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import TfidfVectorizer
from nltk.metrics.distance import edit_distance
from nltk.tokenize import word_tokenize
from nltk.corpus import stopwords
from sentence_transformers import CrossEncoder

nltk.download('punkt', quiet=True)
nltk.download('punkt_tab', quiet=True)
nltk.download('stopwords', quiet=True)
nltk.download('averaged_perceptron_tagger', quiet=True)

print("Loading ML Models (USE & NLI)... please wait.")
use_model = hub.load("https://tfhub.dev/google/universal-sentence-encoder/4")
nli_model = CrossEncoder("cross-encoder/nli-deberta-v3-large")
STOP_WORDS = set(stopwords.words('english'))

def preprocess(text):
    return ' '.join(text.lower().split())

def tokens(text):
    return [w for w in word_tokenize(text.lower()) if w.isalnum() and len(w) > 2]

def keywords(text):
    return [w for w in tokens(text) if w not in STOP_WORDS]

@lru_cache(maxsize=256)
def get_embedding(text: str) -> tuple:
    return tuple(use_model([text])[0].numpy().tolist())

def semantic_similarity(a: str, b: str) -> float:
    emb_a = np.array(get_embedding(a))
    emb_b = np.array(get_embedding(b))
    dot = np.dot(emb_a, emb_b)
    norm = np.linalg.norm(emb_a) * np.linalg.norm(emb_b)
    return float(dot / norm) if norm > 0 else 0.0

def tfidf_cos(a, b):
    vec = TfidfVectorizer(ngram_range=(1, 2), max_features=1000)
    tfidf = vec.fit_transform([a, b])
    return float(cosine_similarity(tfidf[0:1], tfidf[1:2])[0][0])

def jaccard(a, b):
    r, s = set(keywords(a)), set(keywords(b))
    if not r or not s:
        return 0.0
    return len(r & s) / len(r | s)

def edit_sim(a, b):
    a, b = preprocess(a), preprocess(b)
    d = edit_distance(a, b)
    return 1 - d / max(len(a), len(b))

def word_ratio(a, b):
    r_tokens = tokens(a)
    s_tokens = tokens(b)
    r = len(r_tokens)
    if r == 0:
        return 1.0
    ratio = len(s_tokens) / r
    if ratio > 0.8:
        return 1.0
    return min(max(ratio, 0), 1)

def factual_consistency(reference, student):
    scores = nli_model.predict([(reference, student)])[0]
    probs = np.exp(scores) / np.sum(np.exp(scores))
    return probs[2], probs[0]  # entailment, contradiction

def grade_answer(ref, stu, total=10):
    # Short-circuit: identical answers always get full marks
    if preprocess(ref) == preprocess(stu):
        return total, 1.0, 0.0, "✅ Identical answer."

    entail, contra = factual_consistency(ref, stu)

    if contra > 0.60:
        return 0, entail, contra, "❌ Contradiction detected"

    Sj  = jaccard(ref, stu)
    Se  = edit_sim(ref, stu)
    Sc  = tfidf_cos(ref, stu)
    Sw  = word_ratio(ref, stu)
    Stf = semantic_similarity(ref, stu)

    base_score = (
        0.05 * Sj +
        0.05 * Se +
        0.10 * Sc +
        0.10 * Sw +
        0.70 * Stf
    )

    final_marks = base_score * total

    if entail > 0.85:
        final_marks = min(final_marks * 1.10, total)
        msg = "✅ Excellent precision and logic."
    elif entail > 0.60:
        msg = "✅ Factually consistent."
    else:
        msg = "⚠️ Partially consistent."

    return round(min(final_marks, total), 1), entail, contra, msg

def debug_grade(ref, stu, total=10):
    print(f"Sj  = {jaccard(ref, stu):.4f}")
    print(f"Se  = {edit_sim(ref, stu):.4f}")
    print(f"Sc  = {tfidf_cos(ref, stu):.4f}")
    print(f"Sw  = {word_ratio(ref, stu):.4f}")
    print(f"Stf = {semantic_similarity(ref, stu):.4f}")
    e, c = factual_consistency(ref, stu)
    print(f"entail={e:.4f}  contra={c:.4f}")



def _sanity_check():
    test = "The mitochondria is the powerhouse of the cell."
    score = semantic_similarity(test, test)
    assert score > 0.9999, f"Cache bug! Identical text similarity = {score}"
    marks, _, _, _ = grade_answer(test, test)
    assert marks == 10.0, f"Identical answer should be 10, got {marks}"
    print("✅ Sanity check passed")

_sanity_check()
