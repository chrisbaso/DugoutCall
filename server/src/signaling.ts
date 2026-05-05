import type { ServerMessage, SignalingMessage } from './types.js';

export function isSignalingMessage(value: unknown): value is SignalingMessage {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return type === 'webrtc_offer' || type === 'webrtc_answer' || type === 'ice_candidate';
}

export const liveAudioUnavailableMessage: ServerMessage = {
  type: 'error',
  message: 'Live audio requires WebRTC or LiveKit media transport configuration'
};
