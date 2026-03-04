// k6 load test: WebSocket chat connections.
//
// Run:
//   k6 run tests/load/websocket.js
//   k6 run -e BASE_URL=http://localhost:8080 tests/load/websocket.js
//
// Target (from CLAUDE.md):
//   - WebSocket message delivery: < 100ms
//   - ws_connecting p95 < 100ms

import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { randomString, randomInt } from './config.js';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const wsConnectTime = new Trend('ws_connecting', true);
const wsMessageLatency = new Trend('ws_message_latency', true);
const wsMessagesReceived = new Counter('ws_messages_received');
const wsMessagesSent = new Counter('ws_messages_sent');
const wsErrors = new Counter('ws_errors');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Derive WebSocket URL from BASE_URL.
const HTTP_BASE = __ENV.BASE_URL || 'http://localhost:8080';
const WS_BASE = HTTP_BASE.replace(/^http/, 'ws');
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'load-test-token-provider';

export const options = {
    stages: [
        { duration: '20s', target: 50 },  // Ramp up to 50 concurrent connections.
        { duration: '1m', target: 100 },  // Ramp up to 100 connections.
        { duration: '1m', target: 100 },  // Hold at 100 connections.
        { duration: '20s', target: 0 },   // Ramp down.
    ],
    thresholds: {
        // Connection setup time p95 < 100ms.
        ws_connecting: ['p(95)<100'],
        // Message round-trip latency p95 < 100ms.
        ws_message_latency: ['p(95)<100'],
        // No more than 5% connection errors.
        ws_errors: ['count<50'],
    },
};

// ---------------------------------------------------------------------------
// Test execution
// ---------------------------------------------------------------------------

export default function () {
    const url = `${WS_BASE}/ws/chat?token=${AUTH_TOKEN}`;
    const chatId = `load-test-room-${randomInt(1, 20)}`;

    const connectStart = Date.now();

    const res = ws.connect(url, { tags: { name: 'ws_chat' } }, function (socket) {
        const connectDuration = Date.now() - connectStart;
        wsConnectTime.add(connectDuration);

        // --- On Open ---
        socket.on('open', function () {
            // Join a chat room.
            socket.send(
                JSON.stringify({
                    type: 'join',
                    chat_id: chatId,
                }),
            );

            // Send a series of messages with timing.
            for (let i = 0; i < 5; i++) {
                const sendTime = Date.now();
                const msgId = `${randomString(8)}-${i}`;

                socket.send(
                    JSON.stringify({
                        type: 'message',
                        chat_id: chatId,
                        content: `Load test message ${msgId}`,
                        client_msg_id: msgId,
                        sent_at: sendTime,
                    }),
                );
                wsMessagesSent.add(1);
            }

            // Send a ping to measure round-trip time.
            socket.send(
                JSON.stringify({
                    type: 'ping',
                    timestamp: Date.now(),
                }),
            );
        });

        // --- On Message ---
        socket.on('message', function (data) {
            wsMessagesReceived.add(1);

            try {
                const msg = JSON.parse(data);

                // Measure latency for acknowledged messages.
                if (msg.type === 'ack' && msg.sent_at) {
                    const latency = Date.now() - msg.sent_at;
                    wsMessageLatency.add(latency);
                }

                // Measure pong latency.
                if (msg.type === 'pong' && msg.timestamp) {
                    const latency = Date.now() - msg.timestamp;
                    wsMessageLatency.add(latency);
                }

                // Measure server push message latency.
                if (msg.type === 'message' && msg.server_ts) {
                    const latency = Date.now() - msg.server_ts;
                    wsMessageLatency.add(latency);
                }
            } catch {
                // Non-JSON messages are ignored.
            }
        });

        // --- On Error ---
        socket.on('error', function (e) {
            wsErrors.add(1);
        });

        // --- On Close ---
        socket.on('close', function () {
            // Connection closed.
        });

        // Keep the connection alive for a realistic duration.
        socket.setTimeout(function () {
            // Send a leave message before closing.
            socket.send(
                JSON.stringify({
                    type: 'leave',
                    chat_id: chatId,
                }),
            );
            socket.close();
        }, 10000); // Hold connection for 10 seconds.
    });

    check(res, {
        'ws connection established': (r) => r && r.status === 101,
    });

    // Brief pause between connection attempts.
    sleep(1);
}
