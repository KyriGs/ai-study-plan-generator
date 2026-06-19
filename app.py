"""AI Study Plan Generator — Streamlit web app powered by Google Gemini."""

import os

import streamlit as st
from dotenv import load_dotenv
from google import genai
from google.genai import errors as genai_errors
from pydantic import BaseModel

load_dotenv()

MODEL = "gemini-2.5-flash"  # free tier. Swap to a newer flash model if you like.


# ---- Shape of the plan Gemini must return ----
class Task(BaseModel):
    title: str
    detail: str
    minutes: int


class StudyDay(BaseModel):
    day: int
    focus: str
    tasks: list[Task]


class StudyPlan(BaseModel):
    summary: str
    days: list[StudyDay]
    tips: list[str]


SYSTEM = (
    "You are an expert study coach. Build realistic, motivating study plans. "
    "Split work into clear daily tasks with time estimates. Match the plan to "
    "the learner's goal, deadline, and hours available. Be concrete, not vague."
)


def build_plan(goal: str, days: int, hours_per_day: float, level: str) -> StudyPlan:
    """Ask Gemini for a structured study plan."""
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

    prompt = (
        f"Make a {days}-day study plan.\n"
        f"Goal: {goal}\n"
        f"Current level: {level}\n"
        f"Time available: {hours_per_day} hours per day.\n"
        f"Give exactly {days} day entries. Keep daily task minutes within the "
        f"available time."
    )

    response = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config={
            "system_instruction": SYSTEM,
            "response_mime_type": "application/json",
            "response_schema": StudyPlan,
        },
    )
    return response.parsed


def plan_to_text(goal: str, plan: StudyPlan) -> str:
    """Flatten a plan into a downloadable text file."""
    lines = ["AI STUDY PLAN", "=============", f"Goal: {goal}", "", plan.summary, ""]
    for d in plan.days:
        total = sum(t.minutes for t in d.tasks)
        lines.append(f"Day {d.day} - {d.focus}  ({total} min)")
        for t in d.tasks:
            lines.append(f"  - {t.title} ({t.minutes} min): {t.detail}")
        lines.append("")
    lines.append("TIPS")
    for tip in plan.tips:
        lines.append(f"- {tip}")
    return "\n".join(lines)


# ---- Page setup + custom styling ----
st.set_page_config(page_title="AI Study Plan Generator", page_icon="📚")

st.markdown(
    """
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
    html, body, [class*="css"] { font-family: 'Inter', sans-serif; }
    .hero {
        background: linear-gradient(120deg, #6C5CE7 0%, #8E7Cff 100%);
        padding: 28px 32px; border-radius: 16px; color: white; margin-bottom: 8px;
    }
    .hero h1 { margin: 0; font-weight: 800; font-size: 2rem; }
    .hero p  { margin: 6px 0 0; opacity: 0.9; }
    div.stButton > button {
        background: #6C5CE7; color: white; border: 0; border-radius: 10px;
        padding: 0.5rem 1.2rem; font-weight: 600;
    }
    div.stButton > button:hover { background: #5a4bd1; color: white; }
    </style>
    """,
    unsafe_allow_html=True,
)

st.markdown(
    """
    <div class="hero">
        <h1>📚 AI Study Plan Generator</h1>
        <p>Tell it your goal. Get a day-by-day plan built by AI.</p>
    </div>
    """,
    unsafe_allow_html=True,
)

# ---- Input form ----
with st.form("plan_form"):
    goal = st.text_input(
        "What you want to learn / achieve",
        placeholder="e.g. Pass my calculus final",
    )
    col1, col2 = st.columns(2)
    days = col1.slider("Days until deadline", 1, 30, 7)
    hours = col2.slider("Hours you can study per day", 0.5, 8.0, 2.0, 0.5)
    level = st.selectbox(
        "Your current level", ["Beginner", "Intermediate", "Advanced"]
    )
    submitted = st.form_submit_button("Generate plan")

# ---- Generate (store in session so the download button survives reruns) ----
if submitted:
    if not goal.strip():
        st.warning("Type a goal first.")
    elif not os.getenv("GEMINI_API_KEY"):
        st.error("No GEMINI_API_KEY set. Add it to a .env file (see .env.example).")
    else:
        with st.spinner("AI is building your plan..."):
            try:
                st.session_state.plan = build_plan(goal, days, hours, level)
                st.session_state.goal = goal
            except genai_errors.APIError as e:
                st.error(f"API error: {e}")
                st.stop()

# ---- Render the stored plan ----
if "plan" in st.session_state:
    plan = st.session_state.plan
    goal = st.session_state.goal

    st.success(plan.summary)

    st.download_button(
        "⬇️ Download plan (.txt)",
        data=plan_to_text(goal, plan),
        file_name="study_plan.txt",
        mime="text/plain",
    )

    for d in plan.days:
        total = sum(t.minutes for t in d.tasks)
        with st.expander(f"Day {d.day} — {d.focus}  ({total} min)"):
            for t in d.tasks:
                st.markdown(f"**{t.title}** · {t.minutes} min")
                st.write(t.detail)

    st.subheader("Tips")
    for tip in plan.tips:
        st.markdown(f"- {tip}")
