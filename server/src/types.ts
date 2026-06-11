export type UserRole = 'coach' | 'catcher';
export type AppMode = 'game' | 'practice';
export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface Participant {
  id: string;
  role: UserRole;
  displayName?: string;
  joinedAt: number;
}

export interface Room {
  code: string;
  mode: AppMode;
  coach?: Participant;
  catcher?: Participant;
  teamName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface PitchCallMessage {
  type: 'pitch_call';
  id: string;
  pitch: string;
  location?: string;
  spokenText: string;
  timestamp: number;
}

export interface WebRTCOfferMessage {
  type: 'webrtc_offer';
  sdp: string;
}

export interface WebRTCAnswerMessage {
  type: 'webrtc_answer';
  sdp: string;
}

export interface ICECandidateMessage {
  type: 'ice_candidate';
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

export type SignalingMessage = WebRTCOfferMessage | WebRTCAnswerMessage | ICECandidateMessage;

export type ClientMessage =
  | { type: 'create_room'; coachName?: string; teamName?: string }
  | { type: 'join_room'; code: string; role: UserRole; displayName?: string; token: string }
  | PitchCallMessage
  | SignalingMessage
  | { type: 'ptt_start'; timestamp?: number }
  | { type: 'ptt_stop'; timestamp?: number }
  | { type: 'heartbeat'; timestamp?: number };

export type ServerMessage =
  | { type: 'role_assigned'; code: string; role: UserRole; mode: AppMode; expiresAt: number }
  | PitchCallMessage
  | SignalingMessage
  | { type: 'ptt_start'; timestamp: number }
  | { type: 'ptt_stop'; timestamp: number }
  | { type: 'heartbeat'; timestamp: number }
  | { type: 'call_ack'; id: string; recipientCount: number; timestamp: number }
  | { type: 'peer_status'; role: UserRole; connected: boolean }
  | { type: 'room_closed'; reason: string }
  | { type: 'error'; message: string };
