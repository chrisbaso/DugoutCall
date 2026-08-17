"""Synthetic, process-local Diamond server for the cross-repository E2E gate."""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select


if len(sys.argv) != 3:
    raise SystemExit("usage: diamond_fixture_server.py <diamond-repo> <port>")

diamond_repo = Path(sys.argv[1]).resolve()
port = int(sys.argv[2])
sys.path.insert(0, str(diamond_repo))

from app.database import get_session  # noqa: E402
from app.main import app as diamond_app  # noqa: E402
from app.models import (  # noqa: E402
    AppUser,
    DugoutCallDevice,
    DugoutLineup,
    Game,
    Organization,
    Player,
    Team,
)
from app.security import SecurityContext, security_scope  # noqa: E402
from app.services.device_pairing import generate_pairing_code, revoke_paired_device  # noqa: E402


engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SQLModel.metadata.create_all(engine)


def sessions():
    with Session(engine) as session:
        yield session


diamond_app.dependency_overrides[get_session] = sessions
diamond_app.router.on_startup.clear()


def seed_program(session: Session, name: str, opponent_name: str, email: str):
    organization = Organization(name=name, season="2026")
    user = AppUser(email=email, display_name=f"{name} Head Coach", password_hash="synthetic-not-used")
    session.add_all([organization, user])
    session.commit()
    session.refresh(organization)
    session.refresh(user)
    team = Team(tenant_id=organization.id or 0, name=name, season="2026", is_our_team=True)
    opponent = Team(tenant_id=organization.id or 0, name=opponent_name, season="2026")
    session.add_all([team, opponent])
    session.commit()
    session.refresh(team)
    session.refresh(opponent)
    opponent.owner_team_id = team.id
    session.add(opponent)
    hitters = [
        Player(tenant_id=organization.id or 0, team_id=opponent.id, name="Isaiah Kelly", jersey_number="4", bats="R"),
        Player(tenant_id=organization.id or 0, team_id=opponent.id, name="Mason Strey", jersey_number="8", bats="L"),
    ]
    pitcher = Player(
        tenant_id=organization.id or 0,
        team_id=team.id,
        name="Avery Chen",
        jersey_number="12",
        is_pitcher=True,
        is_hitter=False,
    )
    session.add_all([*hitters, pitcher])
    session.commit()
    for row in [*hitters, pitcher]:
        session.refresh(row)
    game = Game(
        tenant_id=organization.id or 0,
        client_game_id=f"fixture-{organization.id}",
        date=date(2026, 8, 18),
        opponent_team_id=opponent.id,
        opponent_name=opponent.name,
        home_away="Home",
        location="Synthetic Pilot Field",
    )
    session.add(game)
    session.commit()
    session.refresh(game)
    session.add(
        DugoutLineup(
            tenant_id=organization.id or 0,
            team_id=opponent.id or 0,
            game_id=game.id,
            player_order_json=json.dumps(["isaiah-kelly", "mason-strey"]),
        )
    )
    session.commit()
    context = SecurityContext(
        organization_id=organization.id or 0,
        active_team_id=team.id or 0,
        user_id=user.id,
        role="head_coach",
    )
    with security_scope(context):
        code, _pairing = generate_pairing_code(session, requested_label="E2E Coach iPhone")
    return {
        "organization_id": organization.id,
        "team_id": team.id,
        "opponent_id": opponent.id,
        "game_id": game.id,
        "hitter_ids": [hitter.id for hitter in hitters],
        "pitcher_id": pitcher.id,
        "user_id": user.id,
        "pairing_code": code,
    }


with Session(engine) as session:
    primary = seed_program(session, "Synthetic Pilot Nine", "Synthetic Hornets", "primary@example.test")
    secondary = seed_program(session, "Second Synthetic Nine", "Second Opponent", "secondary@example.test")


fixture_app = FastAPI(title="Diamond cross-repository synthetic fixture")


@fixture_app.post("/__fixture/revoke")
def revoke_device(device_id: str, session: Session = Depends(sessions)):
    context = SecurityContext(
        organization_id=int(primary["organization_id"]),
        active_team_id=int(primary["team_id"]),
        user_id=int(primary["user_id"]),
        role="head_coach",
    )
    with security_scope(context):
        device = session.exec(select(DugoutCallDevice).where(DugoutCallDevice.public_id == device_id)).first()
        if device is None or not revoke_paired_device(session, device.id or 0):
            raise HTTPException(status_code=404, detail="device not found")
    return {"revoked": True}


fixture_app.mount("/", diamond_app)

print(
    "READY "
    + json.dumps(
        {
            "primary": primary,
            "secondary": secondary,
        },
        sort_keys=True,
    ),
    flush=True,
)
uvicorn.run(fixture_app, host="127.0.0.1", port=port, log_level="error")
