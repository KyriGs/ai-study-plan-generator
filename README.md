# 📚 AI Study Plan Generator

A web app that turns a learning goal into a day-by-day study plan, powered by
Google's Gemini (free tier). Type what you want to learn, your deadline, and
how much time you have — get back a structured plan with daily tasks, time
estimates, and study tips.

Built with [Streamlit](https://streamlit.io) (Python) and the
[Gemini API](https://ai.google.dev), using **structured outputs** (a Pydantic
schema) so the model returns clean, typed data instead of raw text.

## Demo

> Add a screenshot here after first run, and a live link once deployed.

## Features

- Goal-driven plan generation (deadline + hours/day + skill level)
- Structured, validated output via Pydantic schema (no fragile text parsing)
- Per-day task breakdown with time estimates
- Interactive progress tracking (tick off tasks, live progress bar)
- At-a-glance stats (total days, hours, tasks)
- Downloadable plan (.txt)
- Graceful error handling (missing/invalid API key, API errors)

## Tech

| Part         | Choice                          |
|--------------|---------------------------------|
| Language     | Python                          |
| UI           | Streamlit                       |
| AI model     | Gemini (`gemini-2.5-flash`)     |
| Output shape | Pydantic + structured outputs   |

## Run locally

1. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
2. Add your API key:
   - Copy `.env.example` to `.env`
   - Paste your FREE key from https://aistudio.google.com/apikey
3. Start the app:
   ```
   streamlit run app.py
   ```
   It opens at http://localhost:8501

## Deploy (free, public link)

1. Push this folder to a GitHub repo.
2. Go to https://share.streamlit.io, connect the repo, pick `app.py`.
3. In the app's **Settings → Secrets**, add:
   ```
   GEMINI_API_KEY = "your-key"
   ```
4. Deploy. Share the link on your resume.

## How it works

`app.py` defines a `StudyPlan` schema (summary, days, tasks, tips). The app
sends the user's goal to Gemini with `response_schema=StudyPlan`, which forces
the response to match that schema. Streamlit then renders the typed result.

## Ideas to extend

- Export the plan to PDF or a calendar (.ics) file
- Save plans per user (database) and track completion
- Stream the response for a live "typing" effect
- Let the user chat to adjust the plan after it's generated
