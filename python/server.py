"""Minimal FastAPI server exposing a Jev judgment to a frontend.

Run:
    uvicorn server:app --reload

The frontend calls POST /judge with plain text; it never sees
TYPESAFE_API_KEY. Swap the questions below for whatever judgment your
app actually needs.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typesafe_sdk import TypeSafeError

from jevkit import Choice, Noul, Score, get_client

app = FastAPI(title="Jev starter API")
client = get_client()


class JudgeRequest(BaseModel):
    text: str


class JudgeResponse(BaseModel):
    category: str
    intensity: float
    is_urgent: bool


@app.post("/judge", response_model=JudgeResponse)
def judge(req: JudgeRequest) -> JudgeResponse:
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    try:
        result = client.system_one(
            state=req.text,
            questions={
                "category": Choice(
                    instructions="What kind of message is this",
                    criteria={
                        "praise": "Positive feedback",
                        "complaint": "A problem or complaint",
                        "question": "Asking for information",
                    },
                ),
                "intensity": Score(
                    instructions="How strong the emotion behind the message is",
                    criteria=["Neutral", "Mild", "Strong"],
                ),
                "is_urgent": Noul(instructions="The message needs a fast response"),
            },
        )
    except TypeSafeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    answers = result.answers
    return JudgeResponse(
        category=answers["category"].choice,
        intensity=answers["intensity"].score,
        is_urgent=answers["is_urgent"].noul >= 0.5,
    )
