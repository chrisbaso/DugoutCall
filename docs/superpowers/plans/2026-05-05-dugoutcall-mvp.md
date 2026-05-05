# DugoutCall MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-role iOS pitch-calling MVP with a local TypeScript backend.

**Architecture:** The backend owns room creation, role assignment, expiring room codes, tokens, and WebSocket relay. The iOS app owns Game Mode UI, AVFoundation playback, route diagnostics, and one-way coach-to-catcher command handling.

**Tech Stack:** SwiftUI, Swift concurrency, AVFoundation, URLSessionWebSocketTask, Node.js, TypeScript, Express, ws, Vitest.

---

- [x] Scaffold the monorepo structure requested by the product spec.
- [x] Write server tests for room expiry, role limits, token signing, and WebSocket relay.
- [x] Implement server rooms, auth, WebSocket relay, signaling placeholder, and health endpoints.
- [x] Write Swift model tests for pitch phrases, repeat IDs, presets, and JSON message shape.
- [x] Implement Swift models and Codable message types.
- [x] Implement settings, room, WebSocket, speech playback, audio session, route monitor, and push-to-talk services.
- [x] Implement role selection, pairing, coach dashboard, catcher receiver, diagnostics, and settings screens.
- [x] Document setup, compliance constraints, limitations, and manual test checklist.
- [ ] Verify native iOS build on macOS/Xcode.
- [ ] Wire production LiveKit/WebRTC media transport for live coach voice.
