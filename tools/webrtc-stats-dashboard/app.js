/**
 * KAU WebRTC Client Telemetry Dashboard - app.js
 * Multi-Peer SSRC Decomposition & High-Performance Telemetry Visualizer
 */

(() => {
	'use strict';

	// Palette for dynamic peer stream assignment
	const PEER_COLORS = [
		'#38bdf8', // Sky Blue
		'#10b981', // Emerald
		'#a855f7', // Purple
		'#f59e0b', // Amber
		'#ec4899', // Pink
		'#06b6d4', // Cyan
		'#84cc16', // Lime
		'#f97316', // Orange
		'#6366f1', // Indigo
		'#14b8a6', // Teal
	];

	// State
	let rawHistory = [];
	let processedMetrics = [];
	let streamRegistry = new Map(); // key: ssrc => metadata
	let currentFileName = '';
	let currentRoomId = 'unknown';
	let timeAxisMode = 'elapsed'; // 'elapsed' | 'timestamp'

	// Metadata State
	let detectedVideoCodec = 'N/A';
	let detectedAudioCodec = 'N/A';
	let detectedSimulcast = 'N/A';
	let detectedStreamSummary = 'N/A';

	// Charts
	let bitrateChart = null;
	let latencyChart = null;
	let lossChart = null;
	let videoChart = null;
	let isTableCollapsed = true;

	// <KAU> 2026-09-29 START: 방안 B - 역할별 스트림 그룹화 상태 및 DOM 참조
	let activeStreamFilter = 'all'; // 'all' | 'local' | 'remote' | 'probe'

	// DOM Elements
	const dropZone = document.getElementById('dropZone');
	const jsonFileInput = document.getElementById('jsonFileInput');
	const dashboardContent = document.getElementById('dashboardContent');
	const fileInfoBadge = document.getElementById('fileInfoBadge');
	const fileNameDisplay = document.getElementById('fileNameDisplay');
	const fileSampleCount = document.getElementById('fileSampleCount');
	const valDurationText = document.getElementById('valDurationText');
	const valRoomId = document.getElementById('valRoomId');
	const valVideoCodec = document.getElementById('valVideoCodec');
	const valAudioCodec = document.getElementById('valAudioCodec');
	const valSimulcast = document.getElementById('valSimulcast');
	const valStreamCounts = document.getElementById('valStreamCounts');
	const detectedPeersBadge = document.getElementById('detectedPeersBadge');

	// Grouping & Filtering Elements
	const btnFilterAll = document.getElementById('btnFilterAll');
	const btnFilterLocal = document.getElementById('btnFilterLocal');
	const btnFilterRemote = document.getElementById('btnFilterRemote');
	const btnFilterProbe = document.getElementById('btnFilterProbe');
	const countAllStreams = document.getElementById('countAllStreams');
	const countLocalStreams = document.getElementById('countLocalStreams');
	const countRemoteStreams = document.getElementById('countRemoteStreams');
	const countProbeStreams = document.getElementById('countProbeStreams');

	const groupLocalSection = document.getElementById('groupLocalSection');
	const groupRemoteSection = document.getElementById('groupRemoteSection');
	const groupProbeSection = document.getElementById('groupProbeSection');
	const countBadgeLocal = document.getElementById('countBadgeLocal');
	const countBadgeRemote = document.getElementById('countBadgeRemote');
	const countBadgeProbe = document.getElementById('countBadgeProbe');

	const gridLocalMe = document.getElementById('gridLocalMe');
	const gridRemotePeers = document.getElementById('gridRemotePeers');
	const gridProbe = document.getElementById('gridProbe');

	const btnXAxisSec = document.getElementById('btnXAxisSec');
	const btnXAxisKst = document.getElementById('btnXAxisKst');
	const btnResetZoom = document.getElementById('btnResetZoom');
	const btnCopySummary = document.getElementById('btnCopySummary');
	const btnExportCharts = document.getElementById('btnExportCharts');
	const btnLoadDemo = document.getElementById('btnLoadDemo');
	const toastNotification = document.getElementById('toastNotification');
	const tableToggleBtn = document.getElementById('tableToggleBtn');
	const tableContentWrapper = document.getElementById('tableContentWrapper');
	const tableChevron = document.getElementById('tableChevron');
	const dataTableBody = document.getElementById('dataTableBody');
	const tableRowsCount = document.getElementById('tableRowsCount');
	// <KAU> 2026-09-29 END: 방안 B - 역할별 스트림 그룹화 상태 및 DOM 참조

	// Toast Helper
	let toastTimeout = null;
	function showToast(message, duration = 3000) {
		if (toastTimeout) clearTimeout(toastTimeout);
		toastNotification.textContent = message;
		toastNotification.classList.remove('hidden');
		toastTimeout = setTimeout(() => {
			toastNotification.classList.add('hidden');
		}, duration);
	}

	// Helper: Format KST timestamp for axis (HH:mm:ss)
	function formatKstTime(isoStringOrMs) {
		if (!isoStringOrMs) return '';
		try {
			const d = new Date(isoStringOrMs);
			if (isNaN(d.getTime())) return String(isoStringOrMs);
			const formatter = new Intl.DateTimeFormat('ko-KR', {
				timeZone: 'Asia/Seoul',
				hour12: false,
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
			});
			return formatter.format(d);
		} catch {
			return String(isoStringOrMs);
		}
	}

	// Helper: Format seconds to MM:SS
	function formatDuration(sec) {
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	// 1. Multi-Peer Stream Scanner & SSRC Registry Builder
	function buildStreamRegistry(history) {
		const registry = new Map();
		const codecMap = new Map();
		let maxSendVideoLayers = 0;
		let maxRecvVideoTracks = 0;
		let maxRecvAudioTracks = 0;
		let colorIdx = 0;

		history.forEach(item => {
			const sendStats = Array.isArray(item.send) ? item.send : [];
			const recvStats = Array.isArray(item.recv) ? item.recv : [];
			const allStats = [...sendStats, ...recvStats];

			// Scan Codecs
			allStats.forEach(s => {
				if (s.type === 'codec' && s.mimeType) {
					codecMap.set(s.id || s.mimeType, s.mimeType);
				}
			});

			// <KAU> 2026-09-29 START: 방안 B - 역할별 스트림 메타데이터 및 명칭 분류
			// Outbound RTP (100% 나 자신 - Local Me)
			const sendVideo = sendStats.filter(s => s.type === 'outbound-rtp' && (s.kind === 'video' || (!s.kind && s.id?.includes('video'))));
			if (sendVideo.length > maxSendVideoLayers) maxSendVideoLayers = sendVideo.length;

			sendStats.forEach(s => {
				if (s.type === 'outbound-rtp') {
					const key = `send_${s.ssrc}`;
					if (!registry.has(key)) {
						const kind = s.kind || (s.id?.includes('video') ? 'video' : 'audio');
						const layerLabel = s.rid ? ` (Layer ${s.rid})` : '';
						const label = `[내 송신] ${kind === 'video' ? '비디오' : '오디오'}${layerLabel} (SSRC: ${s.ssrc})`;

						registry.set(key, {
							key,
							role: 'local_me',
							roleName: '내 로컬 송신 (Local Me)',
							direction: 'send',
							ssrc: s.ssrc,
							kind,
							rid: s.rid || null,
							isProbator: false,
							label,
							color: kind === 'video' ? '#38bdf8' : '#0284c7',
							firstSec: item.elapsedSec || 0,
							lastSec: item.elapsedSec || 0,
							totalBytes: 0,
							bitrates: [],
							fpsList: [],
							jitters: [],
							// <KAU> 2026-09-29 START: 최대 해상도(Max Height) 추적 프로퍼티
							maxHeight: 0,
							maxWidth: 0,
							maxResolutionLabel: '-',
							// <KAU> 2026-09-29 END: 최대 해상도(Max Height) 추적 프로퍼티
						});
					}
				}
			});

			// Inbound RTP (원격 피어들 및 SFU Probe 트래픽)
			const recvVideo = recvStats.filter(s => s.type === 'inbound-rtp' && (s.kind === 'video' || (!s.kind && s.id?.includes('video'))));
			const recvAudio = recvStats.filter(s => s.type === 'inbound-rtp' && (s.kind === 'audio' || (!s.kind && s.id?.includes('audio'))));
			if (recvVideo.length > maxRecvVideoTracks) maxRecvVideoTracks = recvVideo.length;
			if (recvAudio.length > maxRecvAudioTracks) maxRecvAudioTracks = recvAudio.length;

			recvStats.forEach(s => {
				if (s.type === 'inbound-rtp') {
					const key = `recv_${s.ssrc}`;
					const isProbator = s.ssrc === 1234 || s.trackIdentifier === 'probator';
					if (!registry.has(key)) {
						let label;
						let color;
						let role;
						let roleName;
						const kind = s.kind || 'video';

						if (isProbator) {
							role = 'sfu_probe';
							roleName = 'SFU 시스템 프로빙 (Probator)';
							label = '[SFU 프로브] 더미 패킷 (SSRC: 1234)';
							color = '#f59e0b';
						} else {
							role = 'remote_peer';
							roleName = '원격 피어 (Remote Peer)';
							const peerIdx = colorIdx + 1;
							const shortTrack = s.trackIdentifier ? s.trackIdentifier.substring(0, 6) : '';
							label = `[상대 피어 ${peerIdx}] SSRC: ${s.ssrc}${shortTrack ? ` (${shortTrack})` : ''} [${kind}]`;
							color = PEER_COLORS[colorIdx % PEER_COLORS.length];
							colorIdx++;
						}

						registry.set(key, {
							key,
							role,
							roleName,
							direction: 'recv',
							ssrc: s.ssrc,
							kind,
							trackIdentifier: s.trackIdentifier || null,
							isProbator,
							label,
							color,
							firstSec: 0,
							lastSec: 0,
							totalBytes: 0,
							bitrates: [],
							fpsList: [],
							jitters: [],
							// <KAU> 2026-09-29 START: 최대 해상도(Max Height) 추적 프로퍼티
							maxHeight: 0,
							maxWidth: 0,
							maxResolutionLabel: '-',
							// <KAU> 2026-09-29 END: 최대 해상도(Max Height) 추적 프로퍼티
						});
					}
				}
			});
			// <KAU> 2026-09-29 END: 방안 B - 역할별 스트림 메타데이터 및 명칭 분류
		});

		// Determine display codecs
		let vCodec = 'None';
		let aCodec = 'None';
		for (const mime of codecMap.values()) {
			const lower = mime.toLowerCase();
			if (lower.includes('video/')) {
				vCodec = mime.replace('video/', '').toUpperCase();
			} else if (lower.includes('audio/')) {
				aCodec = mime.replace('audio/', '').toLowerCase();
			}
		}
		detectedVideoCodec = vCodec;
		detectedAudioCodec = aCodec;

		// Determine Simulcast status
		if (maxSendVideoLayers > 1) {
			detectedSimulcast = `ON (${maxSendVideoLayers} Layers)`;
		} else if (maxSendVideoLayers === 1) {
			detectedSimulcast = 'OFF (Single)';
		} else {
			detectedSimulcast = 'No Tx Video';
		}

		detectedStreamSummary = `Tx: ${maxSendVideoLayers}V | Rx: ${maxRecvVideoTracks}V + ${maxRecvAudioTracks}A`;

		return registry;
	}

	// 2. High-Fidelity Metrics Transformer with Per-SSRC Delta Tracking
	function processRawWebRtcStats(history) {
		if (!Array.isArray(history) || history.length === 0) {
			throw new Error('올바른 WebRTC 통계 배열 데이터가 아닙니다.');
		}

		streamRegistry = buildStreamRegistry(history);

		const metrics = [];
		// Previous stats map: key => { bytes, packets, lost, dropped, timestampMs }
		let prevStatsMap = new Map();
		let prevTimestampMs = 0;

		for (let i = 0; i < history.length; i++) {
			const item = history[i];
			const timestampMs = item.timestampMs || (item.isoTime ? new Date(item.isoTime).getTime() : 0);
			const isoTime = item.isoTime || (timestampMs ? new Date(timestampMs).toISOString() : '');
			const kstLabel = formatKstTime(timestampMs || isoTime);

			const sendStats = Array.isArray(item.send) ? item.send : [];
			const recvStats = Array.isArray(item.recv) ? item.recv : [];

			// 1) Find active ICE Candidate-Pair (Transport RTT and BWE)
			let rttMs = null;
			let bweKbps = null;

			const candidatePairs = [...sendStats, ...recvStats].filter(s => s.type === 'candidate-pair');
			const activePair = candidatePairs.find(s => s.state === 'succeeded' || s.nominated) || candidatePairs[0];

			if (activePair) {
				if (typeof activePair.currentRoundTripTime === 'number') {
					rttMs = Math.round(activePair.currentRoundTripTime * 1000 * 10) / 10;
				}
				if (typeof activePair.availableOutgoingBitrate === 'number') {
					bweKbps = Math.round(activePair.availableOutgoingBitrate / 1000);
				}
			}

			// Fallback RTT from remote-inbound-rtp
			if (rttMs === null) {
				const remoteInbound = sendStats.find(s => s.type === 'remote-inbound-rtp');
				if (remoteInbound && typeof remoteInbound.roundTripTime === 'number') {
					rttMs = Math.round(remoteInbound.roundTripTime * 1000 * 10) / 10;
				}
			}

			const timeDeltaSec = prevTimestampMs > 0 ? Math.max(0.2, (timestampMs - prevTimestampMs) / 1000) : 1.0;

			// 2) Process Each Active Stream with Per-SSRC Delta Tracking
			const currentStreams = new Map();
			let sendVideoBitrateSum = 0;
			let sendAudioBitrateSum = 0;
			let recvUserVideoBitrateSum = 0;
			let recvUserAudioBitrateSum = 0;
			let recvProbeBitrateSum = 0;
			let sendFpsSum = 0;
			let sendFpsCount = 0;
			let recvFpsSum = 0;
			let recvFpsCount = 0;
			let userJitterSum = 0;
			let userJitterCount = 0;
			let deltaPacketsSum = 0;
			let deltaLostSum = 0;
			let totalDeltaDropped = 0;
			let nackTotal = 0;
			let pliTotal = 0;

			// A. Outbound RTPs
			sendStats.forEach(s => {
				if (s.type === 'outbound-rtp') {
					const key = `send_${s.ssrc}`;
					const kind = s.kind || (s.id?.includes('video') ? 'video' : 'audio');
					const bytes = s.bytesSent || 0;
					const fps = typeof s.framesPerSecond === 'number' && s.framesPerSecond > 0 ? s.framesPerSecond : 0;

					let bitrateKbps = 0;
					const prev = prevStatsMap.get(key);
					if (prev) {
						const deltaBytes = Math.max(0, bytes - prev.bytes);
						bitrateKbps = Math.round((deltaBytes * 8) / (timeDeltaSec * 1000));
					}

					if (kind === 'video') {
						sendVideoBitrateSum += bitrateKbps;
						if (fps > 0) {
							sendFpsSum += fps;
							sendFpsCount++;
						}
					} else {
						sendAudioBitrateSum += bitrateKbps;
					}

					const streamObj = {
						key,
						ssrc: s.ssrc,
						direction: 'send',
						kind,
						bitrateKbps,
						fps,
						jitterMs: null,
						lossPct: 0,
					};
					currentStreams.set(key, streamObj);

					// Accumulate registry stats
					const reg = streamRegistry.get(key);
					if (reg) {
						reg.lastSec = i;
						reg.totalBytes = bytes;
						reg.bitrates.push(bitrateKbps);
						if (fps > 0) reg.fpsList.push(fps);
						// <KAU> 2026-09-29 START: 송신 비디오 최대 해상도(Max Height) 갱신
						if (typeof s.frameHeight === 'number' && s.frameHeight > 0) {
							if (s.frameHeight > reg.maxHeight) {
								reg.maxHeight = s.frameHeight;
								reg.maxWidth = typeof s.frameWidth === 'number' ? s.frameWidth : 0;
								reg.maxResolutionLabel = `${s.frameHeight}p (${reg.maxWidth}x${s.frameHeight})`;
							}
						}
						// <KAU> 2026-09-29 END: 송신 비디오 최대 해상도(Max Height) 갱신
					}
				}
			});

			// B. Inbound RTPs
			recvStats.forEach(s => {
				if (s.type === 'inbound-rtp') {
					const key = `recv_${s.ssrc}`;
					const kind = s.kind || 'video';
					const isProbator = s.ssrc === 1234 || s.trackIdentifier === 'probator';
					const bytes = s.bytesReceived || 0;
					const packets = s.packetsReceived || 0;
					const lost = s.packetsLost || 0;
					const dropped = s.framesDropped || 0;
					const jitterMs = typeof s.jitter === 'number' ? Math.round(s.jitter * 1000 * 10) / 10 : 0;
					const fps = typeof s.framesPerSecond === 'number' && s.framesPerSecond > 0 ? s.framesPerSecond : 0;

					nackTotal += s.nackCount || 0;
					pliTotal += (s.pliCount || 0) + (s.firCount || 0);

					let bitrateKbps = 0;
					let deltaDropped = 0;
					let lossPct = 0;

					const prev = prevStatsMap.get(key);
					if (prev) {
						const deltaBytes = Math.max(0, bytes - prev.bytes);
						bitrateKbps = Math.round((deltaBytes * 8) / (timeDeltaSec * 1000));

						const dPackets = Math.max(0, packets - prev.packets);
						const dLost = Math.max(0, lost - prev.lost);
						deltaDropped = Math.max(0, dropped - prev.dropped);

						if (dPackets + dLost > 0) {
							lossPct = Math.min(100, Math.round((dLost / (dPackets + dLost)) * 10000) / 100);
						}

						if (!isProbator) {
							deltaPacketsSum += dPackets;
							deltaLostSum += dLost;
							totalDeltaDropped += deltaDropped;
						}
					}

					// Route bitrates: User vs SFU Probe
					if (isProbator) {
						recvProbeBitrateSum += bitrateKbps;
					} else {
						if (kind === 'video') {
							recvUserVideoBitrateSum += bitrateKbps;
							if (fps > 0) {
								recvFpsSum += fps;
								recvFpsCount++;
							}
						} else {
							recvUserAudioBitrateSum += bitrateKbps;
						}

						if (jitterMs > 0) {
							userJitterSum += jitterMs;
							userJitterCount++;
						}
					}

					const streamObj = {
						key,
						ssrc: s.ssrc,
						direction: 'recv',
						kind,
						isProbator,
						bitrateKbps,
						fps,
						jitterMs,
						lossPct,
						deltaDropped,
						cumulativeLost: lost,
					};
					currentStreams.set(key, streamObj);

					// Accumulate registry stats
					const reg = streamRegistry.get(key);
					if (reg) {
						if (reg.firstSec === 0 && i > 0) reg.firstSec = i;
						reg.lastSec = i;
						reg.totalBytes = bytes;
						reg.bitrates.push(bitrateKbps);
						if (fps > 0) reg.fpsList.push(fps);
						if (jitterMs > 0) reg.jitters.push(jitterMs);
						// <KAU> 2026-09-29 START: 수신 피어 비디오 최대 해상도(Max Height) 갱신
						if (typeof s.frameHeight === 'number' && s.frameHeight > 0) {
							if (s.frameHeight > reg.maxHeight) {
								reg.maxHeight = s.frameHeight;
								reg.maxWidth = typeof s.frameWidth === 'number' ? s.frameWidth : 0;
								reg.maxResolutionLabel = `${s.frameHeight}p (${reg.maxWidth}x${s.frameHeight})`;
							}
						}
						// <KAU> 2026-09-29 END: 수신 피어 비디오 최대 해상도(Max Height) 갱신
					}
				}
			});

			// Global Aggregates
			const sendTotalBitrate = sendVideoBitrateSum + sendAudioBitrateSum;
			const recvUserTotalBitrate = recvUserVideoBitrateSum + recvUserAudioBitrateSum;
			const recvGrandTotalBitrate = recvUserTotalBitrate + recvProbeBitrateSum;

			const avgUserJitterMs = userJitterCount > 0 ? Math.round((userJitterSum / userJitterCount) * 10) / 10 : 0;
			const overallLossRatePct = deltaPacketsSum + deltaLostSum > 0 ? Math.min(100, Math.round((deltaLostSum / (deltaPacketsSum + deltaLostSum)) * 10000) / 100) : 0;

			const avgSendFps = sendFpsCount > 0 ? Math.round((sendFpsSum / sendFpsCount) * 10) / 10 : 0;
			const avgRecvFps = recvFpsCount > 0 ? Math.round((recvFpsSum / recvFpsCount) * 10) / 10 : 0;

			// Update prevStatsMap for next second
			const nextPrevMap = new Map();
			currentStreams.forEach((st, k) => {
				const rawStat = [...sendStats, ...recvStats].find(s => s.ssrc === st.ssrc && (st.direction === 'send' ? s.type === 'outbound-rtp' : s.type === 'inbound-rtp'));
				if (rawStat) {
					nextPrevMap.set(k, {
						bytes: st.direction === 'send' ? rawStat.bytesSent || 0 : rawStat.bytesReceived || 0,
						packets: rawStat.packetsReceived || rawStat.packetsSent || 0,
						lost: rawStat.packetsLost || 0,
						dropped: rawStat.framesDropped || 0,
					});
				}
			});
			prevStatsMap = nextPrevMap;
			prevTimestampMs = timestampMs;

			metrics.push({
				index: i,
				elapsedSec: i,
				timestampMs,
				isoTime,
				kstLabel,
				// Totals
				sendVideoBitrate: sendVideoBitrateSum,
				sendAudioBitrate: sendAudioBitrateSum,
				sendTotalBitrate,
				recvUserVideoBitrate: recvUserVideoBitrateSum,
				recvUserAudioBitrate: recvUserAudioBitrateSum,
				recvUserTotalBitrate,
				recvProbeBitrate: recvProbeBitrateSum,
				recvGrandTotalBitrate,
				bweBitrate: bweKbps || (sendTotalBitrate > 0 ? sendTotalBitrate * 1.2 : 0),
				rttMs: rttMs !== null ? rttMs : 0,
				avgUserJitterMs,
				lossRatePct: overallLossRatePct,
				sendFps: avgSendFps,
				recvFps: avgRecvFps,
				framesDropped: totalDeltaDropped,
				nackCount: nackTotal,
				pliCount: pliTotal,
				// Per-SSRC Stream Snapshots
				streams: currentStreams,
			});
		}

		return metrics;
	}

	// 3. Multi-Peer Demo Sample Data Generator
	function generateDemoData() {
		const samplesCount = 90;
		const baseTime = Date.now() - samplesCount * 1000;
		const list = [];

		let p1Bytes = 50000;
		let p2Bytes = 30000;
		let probeBytes = 10000;

		for (let i = 0; i < samplesCount; i++) {
			const time = baseTime + i * 1000;
			const isCongested = i >= 40 && i <= 55;

			// Peer 1 (active from 0s)
			const p1Rate = isCongested ? 400 + Math.random() * 100 : 1200 + Math.random() * 200;
			p1Bytes += Math.round(p1Rate * 125);

			// Peer 2 (joins at 20s)
			let p2Rate = 0;
			if (i >= 20) {
				p2Rate = isCongested ? 250 + Math.random() * 80 : 800 + Math.random() * 150;
				p2Bytes += Math.round(p2Rate * 125);
			}

			// SFU Probe (occurs periodically)
			let probeRate = 0;
			if (i === 15 || i === 45 || i === 70) {
				probeRate = 450 + Math.random() * 200;
				probeBytes += Math.round(probeRate * 125);
			}

			const rtt = isCongested ? 110 + Math.random() * 40 : 25 + Math.random() * 6;
			const p1Jitter = isCongested ? 10 + Math.random() * 5 : 2 + Math.random() * 2;
			const p2Jitter = isCongested ? 14 + Math.random() * 6 : 3 + Math.random() * 2;
			const probeJitter = isCongested ? 95 : 40;

			// <KAU> 2026-09-29 START: 데모 데이터에 frameWidth & frameHeight (해상도) 주입
			const recvList = [
				{
					type: 'inbound-rtp',
					kind: 'video',
					ssrc: 366614059,
					trackIdentifier: 'ea9783de-9281-4544',
					bytesReceived: p1Bytes,
					packetsReceived: 2000 + i * 120,
					packetsLost: isCongested ? Math.floor((i - 40) * 1.5) : 0,
					jitter: p1Jitter / 1000,
					framesPerSecond: isCongested ? 22 : 30,
					frameWidth: 1280,
					frameHeight: 720, // 720p
					framesDropped: isCongested ? Math.floor(i - 40) : 0,
					nackCount: isCongested ? 12 : 0,
					pliCount: isCongested ? 2 : 0,
				},
			];

			if (i >= 20) {
				recvList.push({
					type: 'inbound-rtp',
					kind: 'video',
					ssrc: 996098681,
					trackIdentifier: 'a8e408c6-a29c-4669',
					bytesReceived: p2Bytes,
					packetsReceived: 1000 + (i - 20) * 80,
					packetsLost: isCongested ? Math.floor((i - 40) * 1.2) : 0,
					jitter: p2Jitter / 1000,
					framesPerSecond: isCongested ? 20 : 30,
					frameWidth: 640,
					frameHeight: 360, // 360p
					framesDropped: 0,
				});
			}

			if (probeRate > 0 || probeBytes > 10000) {
				recvList.push({
					type: 'inbound-rtp',
					kind: 'video',
					ssrc: 1234,
					trackIdentifier: 'probator',
					bytesReceived: probeBytes,
					packetsReceived: 800 + i * 30,
					packetsLost: 0,
					jitter: probeJitter / 1000,
					framesPerSecond: 0,
				});
			}

			const sendBitrate = isCongested ? 500 : 1200;
			const sendBytes = (i + 1) * Math.round(sendBitrate * 125);
			const sendList = [
				{
					type: 'outbound-rtp',
					kind: 'video',
					ssrc: 777123456,
					rid: 'q',
					bytesSent: sendBytes,
					packetsSent: 1500 + i * 90,
					framesPerSecond: isCongested ? 24 : 30,
					frameWidth: 1280,
					frameHeight: 720, // 720p
				},
			];
			// <KAU> 2026-09-29 END: 데모 데이터에 frameWidth & frameHeight (해상도) 주입

			list.push({
				timestampMs: time,
				isoTime: new Date(time).toISOString(),
				send: sendList,
				recv: [
					{
						type: 'candidate-pair',
						state: 'succeeded',
						currentRoundTripTime: rtt / 1000,
						availableOutgoingBitrate: (isCongested ? 1500 : 4500) * 1000,
					},
					...recvList,
				],
			});
		}

		return list;
	}

	// 4. Render Per-Role Stream Breakdown Cards & Filters
	// <KAU> 2026-09-29 START: 방안 B - 역할별(Local Me / Remote Peers / SFU Probe) 스트림 카드 렌더링 및 필터링
	function applyStreamFilter(filter) {
		activeStreamFilter = filter;

		[btnFilterAll, btnFilterLocal, btnFilterRemote, btnFilterProbe].forEach(btn => {
			if (btn) btn.classList.remove('active');
		});

		if (filter === 'local') btnFilterLocal?.classList.add('active');
		else if (filter === 'remote') btnFilterRemote?.classList.add('active');
		else if (filter === 'probe') btnFilterProbe?.classList.add('active');
		else btnFilterAll?.classList.add('active');

		if (groupLocalSection) {
			groupLocalSection.classList.toggle('hidden', filter !== 'all' && filter !== 'local');
		}
		if (groupRemoteSection) {
			groupRemoteSection.classList.toggle('hidden', filter !== 'all' && filter !== 'remote');
		}
		if (groupProbeSection) {
			groupProbeSection.classList.toggle('hidden', filter !== 'all' && filter !== 'probe');
		}
	}

	function createPeerCardElement(p) {
		const card = document.createElement('div');
		let cardTypeClass = 'remote-peer';
		if (p.role === 'local_me') cardTypeClass = 'local-me';
		else if (p.role === 'sfu_probe') cardTypeClass = 'probator';

		card.className = `peer-card ${cardTypeClass}`;

		const avgBitrate = p.bitrates.length ? Math.round(p.bitrates.reduce((a, b) => a + b, 0) / p.bitrates.length) : 0;
		const maxBitrate = p.bitrates.length ? Math.max(...p.bitrates) : 0;
		const avgJitter = p.jitters.length ? Math.round((p.jitters.reduce((a, b) => a + b, 0) / p.jitters.length) * 10) / 10 : '-';
		const avgFps = p.fpsList.length ? Math.round((p.fpsList.reduce((a, b) => a + b, 0) / p.fpsList.length) * 10) / 10 : '-';
		const totalMb = (p.totalBytes / (1024 * 1024)).toFixed(2);

		let badgeClass = 'badge-video';
		let badgeText = p.kind ? p.kind.toUpperCase() : 'MEDIA';
		if (p.role === 'sfu_probe') {
			badgeClass = 'badge-probe';
			badgeText = 'SFU PROBE';
		} else if (p.role === 'local_me') {
			badgeClass = 'badge-local';
			badgeText = p.rid ? `TX (L${p.rid})` : `TX (${p.kind.toUpperCase()})`;
		} else if (p.kind === 'audio') {
			badgeClass = 'badge-audio';
			badgeText = 'AUDIO RX';
		} else {
			badgeClass = 'badge-remote';
			badgeText = 'VIDEO RX';
		}

		const bytesLabel = p.direction === 'send' ? '누적 송신량' : '누적 수신량';
		const jitterLabel = p.direction === 'send' ? '지터 (수신측)' : '평균 지터';
		const fpsLabel = p.direction === 'send' ? '인코딩 FPS' : '디코딩 FPS';

		// <KAU> 2026-09-29 START: 최대 해상도(Max Height) 라벨 및 색상 계산
		let maxResText = '-';
		let resColor = 'var(--text-primary)';
		if (p.isProbator) {
			maxResText = 'N/A (더미 패킷)';
			resColor = 'var(--text-muted)';
		} else if (p.kind === 'audio') {
			maxResText = 'N/A (오디오)';
			resColor = 'var(--text-muted)';
		} else if (p.maxHeight > 0) {
			maxResText = `${p.maxHeight}p (${p.maxWidth}x${p.maxHeight})`;
			if (p.maxHeight >= 720) resColor = '#38bdf8'; // 상 (High)
			else if (p.maxHeight >= 360) resColor = '#34d399'; // 중 (Medium)
			else resColor = '#fbbf24'; // 하 (Low)
		}
		// <KAU> 2026-09-29 END: 최대 해상도(Max Height) 라벨 및 색상 계산

		card.innerHTML = `
			<div class="peer-card-top">
				<span class="peer-card-label">
					<span class="color-indicator" style="background: ${p.color};"></span>
					${p.label}
				</span>
				<span class="peer-card-badge ${badgeClass}">${badgeText}</span>
			</div>
			<div class="peer-metrics-list">
				<div class="peer-metric-item">
					<span>활성 구간</span>
					<strong>${p.firstSec}s ~ ${p.lastSec}s (${p.lastSec - p.firstSec + 1}초)</strong>
				</div>
				<div class="peer-metric-item">
					<span>평균 비트레이트</span>
					<strong>${avgBitrate.toLocaleString()} kbps (최대 ${maxBitrate.toLocaleString()})</strong>
				</div>
				<div class="peer-metric-item">
					<span>${jitterLabel}</span>
					<strong>${avgJitter} ${avgJitter !== '-' ? 'ms' : ''}</strong>
				</div>
				<div class="peer-metric-item">
					<span>${fpsLabel}</span>
					<strong>${avgFps} ${avgFps !== '-' ? 'fps' : ''}</strong>
				</div>
				<div class="peer-metric-item">
					<span>${bytesLabel}</span>
					<strong>${totalMb} MB (${p.totalBytes.toLocaleString()} B)</strong>
				</div>
				<!-- <KAU> 2026-09-29 START: 최대 해상도 항목 UI -->
				<div class="peer-metric-item">
					<span>최대 해상도</span>
					<strong style="color: ${resColor}; font-weight: 700;">${maxResText}</strong>
				</div>
				<!-- <KAU> 2026-09-29 END: 최대 해상도 항목 UI -->
			</div>
		`;
		return card;
	}

	function renderPeerCards() {
		gridLocalMe.innerHTML = '';
		gridRemotePeers.innerHTML = '';
		gridProbe.innerHTML = '';

		const allStreams = Array.from(streamRegistry.values());
		const localStreams = allStreams.filter(p => p.role === 'local_me');
		const remoteStreams = allStreams.filter(p => p.role === 'remote_peer');
		const probeStreams = allStreams.filter(p => p.role === 'sfu_probe');

		// Header Badges & Filter Counters
		if (countAllStreams) countAllStreams.textContent = allStreams.length;
		if (countLocalStreams) countLocalStreams.textContent = localStreams.length;
		if (countRemoteStreams) countRemoteStreams.textContent = remoteStreams.length;
		if (countProbeStreams) countProbeStreams.textContent = probeStreams.length;

		if (countBadgeLocal) countBadgeLocal.textContent = `${localStreams.length}개 트랙`;
		if (countBadgeRemote) countBadgeRemote.textContent = `${remoteStreams.length}개 트랙`;
		if (countBadgeProbe) countBadgeProbe.textContent = `${probeStreams.length}개 트랙`;

		if (detectedPeersBadge) {
			detectedPeersBadge.textContent = `총 ${allStreams.length}개 스트림 (내 송신 ${localStreams.length} / 상대 피어 ${remoteStreams.length} / SFU 프로브 ${probeStreams.length})`;
		}

		// 1. Render Local Me
		if (localStreams.length === 0) {
			gridLocalMe.innerHTML = '<div class="empty-group-notice">현재 세션은 수신 전용(Consume-Only)으로 동작하여 로컬 송신(Tx) 트랙이 없습니다.</div>';
		} else {
			localStreams.forEach(p => gridLocalMe.appendChild(createPeerCardElement(p)));
		}

		// 2. Render Remote Peers
		if (remoteStreams.length === 0) {
			gridRemotePeers.innerHTML = '<div class="empty-group-notice">현재 수신 중인 상대방 피어(Rx) 트랙이 없습니다. (송출 전용 모드 또는 단독 참가)</div>';
		} else {
			remoteStreams.forEach(p => gridRemotePeers.appendChild(createPeerCardElement(p)));
		}

		// 3. Render SFU Probe
		if (probeStreams.length === 0) {
			gridProbe.innerHTML = '<div class="empty-group-notice">SFU 대역폭 프로빙(Probe) 트래픽이 감지되지 않았습니다.</div>';
		} else {
			probeStreams.forEach(p => gridProbe.appendChild(createPeerCardElement(p)));
		}

		applyStreamFilter(activeStreamFilter);
	}
	// <KAU> 2026-09-29 END: 방안 B - 역할별(Local Me / Remote Peers / SFU Probe) 스트림 카드 렌더링 및 필터링

	// 5. UI Update: KPI Cards & Header Stats
	function updateKPIs(metrics) {
		if (metrics.length === 0) return;

		// Bitrate
		const sendRates = metrics.map(m => m.sendTotalBitrate);
		const recvRates = metrics.map(m => m.recvUserTotalBitrate);
		const sendAvg = Math.round(sendRates.reduce((a, b) => a + b, 0) / sendRates.length);
		const sendPeak = Math.max(...sendRates);
		const recvAvg = Math.round(recvRates.reduce((a, b) => a + b, 0) / recvRates.length);

		document.getElementById('kpiSendBitrateAvg').textContent = sendAvg.toLocaleString();
		document.getElementById('kpiSendBitratePeak').textContent = `${sendPeak.toLocaleString()} kbps`;
		document.getElementById('kpiRecvBitrateAvg').textContent = `${recvAvg.toLocaleString()} kbps`;
		document.getElementById('kpiBitrateBar').style.width = `${Math.min(100, Math.round((recvAvg / 4000) * 100))}%`;

		// RTT Latency
		const rtts = metrics.map(m => m.rttMs).filter(r => r > 0);
		const rttAvg = rtts.length ? Math.round((rtts.reduce((a, b) => a + b, 0) / rtts.length) * 10) / 10 : 0;
		const rttMax = rtts.length ? Math.max(...rtts) : 0;
		const rttMin = rtts.length ? Math.min(...rtts) : 0;

		document.getElementById('kpiRttAvg').textContent = rttAvg;
		document.getElementById('kpiRttMax').textContent = `${rttMax} ms`;
		document.getElementById('kpiRttMin').textContent = `${rttMin} ms`;
		document.getElementById('kpiRttBar').style.width = `${Math.min(100, Math.round((rttAvg / 150) * 100))}%`;

		// Jitter & Loss
		const jitters = metrics.map(m => m.avgUserJitterMs).filter(j => j > 0);
		const jitterAvg = jitters.length ? Math.round((jitters.reduce((a, b) => a + b, 0) / jitters.length) * 10) / 10 : 0;
		const losses = metrics.map(m => m.lossRatePct);
		const lossAvg = Math.round((losses.reduce((a, b) => a + b, 0) / losses.length) * 100) / 100;
		const totalDropped = metrics.reduce((a, b) => a + b.framesDropped, 0);

		document.getElementById('kpiLossRateAvg').textContent = lossAvg;
		document.getElementById('kpiJitterAvg').textContent = `${jitterAvg} ms`;
		document.getElementById('kpiTotalLoss').textContent = `${totalDropped} frames`;
		document.getElementById('kpiLossBar').style.width = `${Math.min(100, Math.round(lossAvg * 20))}%`;

		// Video FPS & Drops
		const fpsList = metrics.map(m => m.recvFps).filter(f => f > 0);
		const fpsAvg = fpsList.length ? Math.round((fpsList.reduce((a, b) => a + b, 0) / fpsList.length) * 10) / 10 : 0;
		const totalNack = metrics.reduce((a, b) => Math.max(a, b.nackCount), 0);

		document.getElementById('kpiFpsAvg').textContent = fpsAvg;
		document.getElementById('kpiFramesDropped').textContent = `${totalDropped} frames`;
		document.getElementById('kpiNackTotal').textContent = `${totalNack}건`;
		document.getElementById('kpiVideoBar').style.width = `${Math.min(100, Math.round((fpsAvg / 30) * 100))}%`;

		// Header info pills
		valDurationText.textContent = formatDuration(metrics.length);
		valRoomId.textContent = currentRoomId;
		if (valVideoCodec) valVideoCodec.textContent = detectedVideoCodec;
		if (valAudioCodec) valAudioCodec.textContent = detectedAudioCodec;
		if (valSimulcast) valSimulcast.textContent = detectedSimulcast;
		if (valStreamCounts) valStreamCounts.textContent = detectedStreamSummary;
	}

	// 6. Render Data Table
	function renderTable(metrics) {
		dataTableBody.innerHTML = '';
		tableRowsCount.textContent = `${metrics.length} 행`;

		const fragment = document.createDocumentFragment();
		metrics.forEach(m => {
			const tr = document.createElement('tr');
			tr.innerHTML = `
				<td>${m.elapsedSec}s</td>
				<td>${m.kstLabel}</td>
				<td>${m.sendTotalBitrate.toLocaleString()}</td>
				<td>${m.recvUserTotalBitrate.toLocaleString()}</td>
				<td>${Math.round(m.bweBitrate).toLocaleString()}</td>
				<td style="color: ${m.rttMs > 100 ? '#f87171' : 'inherit'}">${m.rttMs}</td>
				<td>${m.avgUserJitterMs}</td>
				<td style="color: ${m.lossRatePct > 1 ? '#f87171' : 'inherit'}">${m.lossRatePct}%</td>
				<td>${m.sendFps}</td>
				<td>${m.recvFps}</td>
				<td>${m.framesDropped}</td>
			`;
			fragment.appendChild(tr);
		});
		dataTableBody.appendChild(fragment);
	}

	// 7. Dynamic Multi-Peer ECharts Series Config & Rendering
	function getCommonChartOptions(xAxisData) {
		return {
			backgroundColor: 'transparent',
			animation: true,
			animationDuration: 800,
			legend: {
				type: 'scroll',
				top: 0,
				textStyle: { color: '#94a3b8', fontSize: 11, fontFamily: 'Outfit, sans-serif' },
				pageTextStyle: { color: '#94a3b8' },
				pageIconColor: '#38bdf8',
				pageIconInactiveColor: '#475569',
			},
			tooltip: {
				trigger: 'axis',
				axisPointer: {
					type: 'cross',
					crossStyle: { color: 'rgba(255, 255, 255, 0.2)' },
				},
				backgroundColor: 'rgba(15, 23, 42, 0.95)',
				borderColor: 'rgba(56, 189, 248, 0.4)',
				borderWidth: 1,
				textStyle: { color: '#f8fafc', fontSize: 12, fontFamily: 'Outfit, sans-serif' },
				padding: [10, 14],
			},
			grid: {
				top: 45,
				left: 60,
				right: 35,
				bottom: 50,
			},
			xAxis: {
				type: 'category',
				data: xAxisData,
				boundaryGap: false,
				axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
				axisLabel: {
					color: '#94a3b8',
					fontFamily: 'JetBrains Mono',
					fontSize: 11,
				},
			},
			dataZoom: [
				{ type: 'inside', start: 0, end: 100 },
				{
					type: 'slider',
					start: 0,
					end: 100,
					height: 20,
					bottom: 10,
					borderColor: 'transparent',
					backgroundColor: 'rgba(0, 0, 0, 0.3)',
					fillerColor: 'rgba(56, 189, 248, 0.15)',
					handleStyle: { color: '#38bdf8' },
					textStyle: { color: '#94a3b8', fontSize: 10 },
				},
			],
		};
	}

	function renderCharts(metrics) {
		const xAxisData = metrics.map(m => (timeAxisMode === 'elapsed' ? `${m.elapsedSec}s` : m.kstLabel));

		if (!bitrateChart) bitrateChart = echarts.init(document.getElementById('bitrateChart'));
		if (!latencyChart) latencyChart = echarts.init(document.getElementById('latencyChart'));
		if (!lossChart) lossChart = echarts.init(document.getElementById('lossChart'));
		if (!videoChart) videoChart = echarts.init(document.getElementById('videoChart'));

		// <KAU> 2026-09-29 START: 방안 B - 차트 시리즈 역할별 명칭 및 송수신 분리
		// --- Chart 1: Bitrate & Bandwidth (Multi-Peer Dynamic Series) ---
		const bitrateSeries = [];

		// 1) Local Me Send Bitrate Total (if producing)
		const hasSend = metrics.some(m => m.sendTotalBitrate > 0);
		if (hasSend) {
			bitrateSeries.push({
				name: '👤 [내 송신 총합] (Local Tx Total)',
				type: 'line',
				smooth: true,
				data: metrics.map(m => m.sendTotalBitrate),
				lineStyle: { width: 3, color: '#38bdf8' },
				areaStyle: {
					color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
						{ offset: 0, color: 'rgba(56, 189, 248, 0.25)' },
						{ offset: 1, color: 'rgba(56, 189, 248, 0.0)' },
					]),
				},
				itemStyle: { color: '#38bdf8' },
				symbol: 'none',
			});
		}

		// 2) Remote Peers Recv Bitrate Total
		bitrateSeries.push({
			name: '👥 [상대 피어 수신 총합] (Remote Rx Total)',
			type: 'line',
			smooth: true,
			data: metrics.map(m => m.recvUserTotalBitrate),
			lineStyle: { width: 3, color: '#10b981' },
			areaStyle: {
				color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
					{ offset: 0, color: 'rgba(16, 185, 129, 0.25)' },
					{ offset: 1, color: 'rgba(16, 185, 129, 0.0)' },
				]),
			},
			itemStyle: { color: '#10b981' },
			symbol: 'none',
		});

		// 3) BWE Available Outgoing Bitrate
		bitrateSeries.push({
			name: '⚡ [SFU 가용 대역폭] (BWE)',
			type: 'line',
			smooth: true,
			data: metrics.map(m => m.bweBitrate),
			lineStyle: { width: 2, type: 'dashed', color: '#f59e0b' },
			itemStyle: { color: '#f59e0b' },
			symbol: 'none',
		});

		// 4) SFU Probe Traffic (if present)
		const hasProbe = metrics.some(m => m.recvProbeBitrate > 0);
		if (hasProbe) {
			bitrateSeries.push({
				name: '⚙️ [SFU 더미 프로브] (Probe)',
				type: 'line',
				smooth: true,
				data: metrics.map(m => m.recvProbeBitrate),
				lineStyle: { width: 1.5, type: 'dotted', color: '#d97706' },
				itemStyle: { color: '#d97706' },
				symbol: 'none',
			});
		}

		// 5) Individual Streams (Local Me Tracks & Remote Peer Tracks)
		streamRegistry.forEach(stream => {
			if (stream.isProbator) return; // already included above
			bitrateSeries.push({
				name: stream.label,
				type: 'line',
				smooth: true,
				data: metrics.map(m => {
					const st = m.streams.get(stream.key);
					return st ? st.bitrateKbps : 0;
				}),
				lineStyle: { width: 2, color: stream.color },
				itemStyle: { color: stream.color },
				symbol: 'none',
			});
		});

		const bitrateOption = {
			...getCommonChartOptions(xAxisData),
			yAxis: {
				type: 'value',
				name: '비트레이트 (kbps)',
				nameTextStyle: { color: '#94a3b8', fontSize: 11 },
				axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
				splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
				axisLabel: { color: '#94a3b8', fontFamily: 'JetBrains Mono' },
			},
			series: bitrateSeries,
		};
		bitrateChart.setOption(bitrateOption, true);

		// --- Chart 2: Latency & Per-Peer Jitter ---
		const latencySeries = [
			{
				name: 'Transport RTT (클라이언트 ↔ SFU)',
				type: 'line',
				smooth: true,
				data: metrics.map(m => m.rttMs),
				lineStyle: { width: 2.5, color: '#f59e0b' },
				itemStyle: { color: '#f59e0b' },
				symbol: 'none',
				markLine: {
					silent: true,
					lineStyle: { color: '#ef4444', type: 'dashed' },
					data: [{ yAxis: 100, label: { formatter: '100ms 경고', position: 'end', color: '#f87171' } }],
				},
			},
			{
				name: '상대 피어 평균 Jitter (ms)',
				type: 'line',
				yAxisIndex: 1,
				smooth: true,
				data: metrics.map(m => m.avgUserJitterMs),
				lineStyle: { width: 2.5, color: '#ec4899' },
				itemStyle: { color: '#ec4899' },
				symbol: 'none',
			},
		];

		// Add Per-Peer Jitter Series
		streamRegistry.forEach(stream => {
			if (stream.direction !== 'recv') return;
			latencySeries.push({
				name: `${stream.label} 지터`,
				type: 'line',
				yAxisIndex: 1,
				smooth: true,
				data: metrics.map(m => {
					const st = m.streams.get(stream.key);
					return st && st.jitterMs !== null ? st.jitterMs : 0;
				}),
				lineStyle: { width: 1.5, type: 'dotted', color: stream.color },
				itemStyle: { color: stream.color },
				symbol: 'none',
			});
		});

		const latencyOption = {
			...getCommonChartOptions(xAxisData),
			yAxis: [
				{
					type: 'value',
					name: 'RTT (ms)',
					nameTextStyle: { color: '#fbbf24', fontSize: 11 },
					axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
					splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
					axisLabel: { color: '#fbbf24', fontFamily: 'JetBrains Mono' },
				},
				{
					type: 'value',
					name: 'Jitter (ms)',
					nameTextStyle: { color: '#ec4899', fontSize: 11 },
					axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
					splitLine: { show: false },
					axisLabel: { color: '#ec4899', fontFamily: 'JetBrains Mono' },
				},
			],
			series: latencySeries,
		};
		latencyChart.setOption(latencyOption, true);

		// --- Chart 3: Loss & Error Recovery ---
		const lossOption = {
			...getCommonChartOptions(xAxisData),
			yAxis: [
				{
					type: 'value',
					name: '손실률 (%)',
					nameTextStyle: { color: '#f87171', fontSize: 11 },
					axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
					splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
					axisLabel: { color: '#f87171', fontFamily: 'JetBrains Mono' },
				},
				{
					type: 'value',
					name: '시그널 건수',
					nameTextStyle: { color: '#c084fc', fontSize: 11 },
					axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
					splitLine: { show: false },
					axisLabel: { color: '#c084fc', fontFamily: 'JetBrains Mono' },
				},
			],
			series: [
				{
					name: '패킷 손실률 (%)',
					type: 'line',
					smooth: true,
					data: metrics.map(m => m.lossRatePct),
					lineStyle: { width: 2.5, color: '#ef4444' },
					areaStyle: {
						color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
							{ offset: 0, color: 'rgba(239, 68, 68, 0.3)' },
							{ offset: 1, color: 'rgba(239, 68, 68, 0.0)' },
						]),
					},
					itemStyle: { color: '#ef4444' },
					symbol: 'none',
				},
				{
					name: 'NACK 요청',
					type: 'bar',
					yAxisIndex: 1,
					data: metrics.map(m => m.nackCount),
					itemStyle: { color: '#fb923c' },
				},
				{
					name: 'PLI/FIR 키프레임',
					type: 'bar',
					yAxisIndex: 1,
					data: metrics.map(m => m.pliCount),
					itemStyle: { color: '#a855f7' },
				},
			],
		};
		lossChart.setOption(lossOption, true);

		// --- Chart 4: Video FPS & Dropped Frames (Per-Peer FPS) ---
		const videoSeries = [];

		// Send FPS (Local Me)
		const hasSendVideo = metrics.some(m => m.sendFps > 0);
		if (hasSendVideo) {
			videoSeries.push({
				name: '👤 [내 송신] 비디오 FPS',
				type: 'line',
				smooth: true,
				data: metrics.map(m => m.sendFps),
				lineStyle: { width: 2.5, color: '#38bdf8' },
				itemStyle: { color: '#38bdf8' },
				symbol: 'circle',
				symbolSize: 4,
			});
		}

		// Individual Peer Video FPS
		streamRegistry.forEach(stream => {
			if (stream.direction !== 'recv' || stream.kind !== 'video' || stream.isProbator) return;
			videoSeries.push({
				name: `${stream.label} FPS`,
				type: 'line',
				smooth: true,
				data: metrics.map(m => {
					const st = m.streams.get(stream.key);
					return st && st.fps > 0 ? st.fps : null;
				}),
				lineStyle: { width: 2, color: stream.color },
				itemStyle: { color: stream.color },
				symbol: 'circle',
				symbolSize: 4,
			});
		});

		// Dropped Frames Bar
		videoSeries.push({
			name: '초당 드랍 프레임 (수신측)',
			type: 'bar',
			yAxisIndex: 1,
			data: metrics.map(m => m.framesDropped),
			itemStyle: { color: 'rgba(239, 68, 68, 0.7)' },
		});
		// <KAU> 2026-09-29 END: 방안 B - 차트 시리즈 역할별 명칭 및 송수신 분리

		const videoOption = {
			...getCommonChartOptions(xAxisData),
			yAxis: [
				{
					type: 'value',
					name: 'FPS (프레임/초)',
					min: 0,
					max: 40,
					nameTextStyle: { color: '#38bdf8', fontSize: 11 },
					axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
					splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
					axisLabel: { color: '#38bdf8', fontFamily: 'JetBrains Mono' },
				},
				{
					type: 'value',
					name: '드랍 프레임',
					nameTextStyle: { color: '#ef4444', fontSize: 11 },
					axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.1)' } },
					splitLine: { show: false },
					axisLabel: { color: '#ef4444', fontFamily: 'JetBrains Mono' },
				},
			],
			series: videoSeries,
		};
		videoChart.setOption(videoOption, true);

		// Synchronize hover / tooltips across all 4 charts!
		echarts.connect([bitrateChart, latencyChart, lossChart, videoChart]);
	}

	// 8. Data Load Handler
	function loadData(rawJson, fileName) {
		try {
			let parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;

			if (parsed.stats && Array.isArray(parsed.stats)) {
				parsed = parsed.stats;
			}

			rawHistory = parsed;
			currentFileName = fileName || 'webrtc_stats.json';

			const match = currentFileName.match(/webrtc_stats_([^_]+)_/);
			currentRoomId = match ? match[1] : (parsed[0]?.roomId || 'room');

			processedMetrics = processRawWebRtcStats(rawHistory);

			// UI Updates
			fileNameDisplay.textContent = currentFileName;
			fileSampleCount.textContent = `${processedMetrics.length} samples`;
			fileInfoBadge.classList.remove('hidden');
			dropZone.classList.add('hidden');
			dashboardContent.classList.remove('hidden');

			renderPeerCards();
			updateKPIs(processedMetrics);
			renderCharts(processedMetrics);
			renderTable(processedMetrics);

			showToast(`성공적으로 ${processedMetrics.length}초 분량의 다중 피어 WebRTC 통계를 로드했습니다.`);
		} catch (error) {
			console.error('Data parsing error:', error);
			alert(`데이터를 파싱할 수 없습니다: ${error.message}`);
		}
	}

	// 9. Event Listeners
	jsonFileInput.addEventListener('change', event => {
		const file = event.target.files[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = e => {
			loadData(e.target.result, file.name);
		};
		reader.readAsText(file);
	});

	['dragenter', 'dragover'].forEach(eventName => {
		dropZone.addEventListener(eventName, e => {
			e.preventDefault();
			e.stopPropagation();
			dropZone.classList.add('dragover');
		});
	});

	['dragleave', 'drop'].forEach(eventName => {
		dropZone.addEventListener(eventName, e => {
			e.preventDefault();
			e.stopPropagation();
			dropZone.classList.remove('dragover');
		});
	});

	dropZone.addEventListener('drop', e => {
		const file = e.dataTransfer.files[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = ev => {
			loadData(ev.target.result, file.name);
		};
		reader.readAsText(file);
	});

	btnLoadDemo.addEventListener('click', () => {
		const demoHistory = generateDemoData();
		loadData(demoHistory, 'demo_multi_peer_session.json');
	});

	btnXAxisSec.addEventListener('click', () => {
		if (timeAxisMode === 'elapsed') return;
		timeAxisMode = 'elapsed';
		btnXAxisSec.classList.add('active');
		btnXAxisKst.classList.remove('active');
		renderCharts(processedMetrics);
	});

	btnXAxisKst.addEventListener('click', () => {
		if (timeAxisMode === 'timestamp') return;
		timeAxisMode = 'timestamp';
		btnXAxisKst.classList.add('active');
		btnXAxisSec.classList.remove('active');
		renderCharts(processedMetrics);
	});

	btnResetZoom.addEventListener('click', () => {
		[bitrateChart, latencyChart, lossChart, videoChart].forEach(chart => {
			if (chart) {
				chart.dispatchAction({
					type: 'dataZoom',
					start: 0,
					end: 100,
				});
			}
		});
		showToast('줌 레벨이 초기화되었습니다.');
	});

	tableToggleBtn.addEventListener('click', () => {
		isTableCollapsed = !isTableCollapsed;
		if (isTableCollapsed) {
			tableContentWrapper.classList.add('collapsed');
			tableChevron.classList.remove('open');
		} else {
			tableContentWrapper.classList.remove('collapsed');
			tableChevron.classList.add('open');
		}
	});

	// <KAU> 2026-09-29 START: 방안 B - 역할별 필터 이벤트 및 마크다운 리포트 생성
	// Filter tab button click events
	btnFilterAll?.addEventListener('click', () => applyStreamFilter('all'));
	btnFilterLocal?.addEventListener('click', () => applyStreamFilter('local'));
	btnFilterRemote?.addEventListener('click', () => applyStreamFilter('remote'));
	btnFilterProbe?.addEventListener('click', () => applyStreamFilter('probe'));

	btnCopySummary.addEventListener('click', () => {
		if (processedMetrics.length === 0) {
			showToast('먼저 데이터를 로드해주세요.');
			return;
		}

		const sendRates = processedMetrics.map(m => m.sendTotalBitrate);
		const recvRates = processedMetrics.map(m => m.recvUserTotalBitrate);
		const rtts = processedMetrics.map(m => m.rttMs).filter(r => r > 0);
		const jitters = processedMetrics.map(m => m.avgUserJitterMs).filter(j => j > 0);
		const losses = processedMetrics.map(m => m.lossRatePct);

		const sendAvg = Math.round(sendRates.reduce((a, b) => a + b, 0) / sendRates.length);
		const sendMax = Math.max(...sendRates);
		const recvAvg = Math.round(recvRates.reduce((a, b) => a + b, 0) / recvRates.length);
		const recvMax = Math.max(...recvRates);
		const rttAvg = rtts.length ? Math.round((rtts.reduce((a, b) => a + b, 0) / rtts.length) * 10) / 10 : 0;
		const rttMax = rtts.length ? Math.max(...rtts) : 0;
		const jitterAvg = jitters.length ? Math.round((jitters.reduce((a, b) => a + b, 0) / jitters.length) * 10) / 10 : 0;
		const lossAvg = Math.round((losses.reduce((a, b) => a + b, 0) / losses.length) * 100) / 100;
		const totalDropped = processedMetrics.reduce((a, b) => a + b.framesDropped, 0);

		// Build Markdown tables grouped by Role
		const allStreams = Array.from(streamRegistry.values());
		const localStreams = allStreams.filter(p => p.role === 'local_me');
		const remoteStreams = allStreams.filter(p => p.role === 'remote_peer');
		const probeStreams = allStreams.filter(p => p.role === 'sfu_probe');

		// <KAU> 2026-09-29 START: 마크다운 리포트에 최대 해상도 컬럼 추가
		function buildStreamRows(streams, isTx = false) {
			if (streams.length === 0) return '| *해당 역할의 스트림이 없습니다.* | - | - | - | - | - | - | - |\n';
			let rows = '';
			streams.forEach(p => {
				const pAvgRate = p.bitrates.length ? Math.round(p.bitrates.reduce((a, b) => a + b, 0) / p.bitrates.length) : 0;
				const pMaxRate = p.bitrates.length ? Math.max(...p.bitrates) : 0;
				const pAvgJitter = p.jitters.length ? (p.jitters.reduce((a, b) => a + b, 0) / p.jitters.length).toFixed(1) : '-';
				const pAvgFps = p.fpsList.length ? (p.fpsList.reduce((a, b) => a + b, 0) / p.fpsList.length).toFixed(1) : '-';
				const dataVol = (p.totalBytes / (1024 * 1024)).toFixed(2);
				const resText = p.kind === 'video' ? (p.maxHeight > 0 ? `${p.maxHeight}p` : '-') : 'N/A';
				rows += `| **${p.label}** | ${p.kind} | ${resText} | ${p.firstSec}s~${p.lastSec}s | ${pAvgRate} kbps (Max ${pMaxRate}) | ${pAvgJitter} ms | ${pAvgFps} fps | ${dataVol} MB |\n`;
			});
			return rows;
		}

		const md = `### [KAU WebRTC Role-Separated Telemetry Report]
- **Session File:** \`${currentFileName}\`
- **Room ID:** \`${currentRoomId}\`
- **Duration:** ${formatDuration(processedMetrics.length)} (${processedMetrics.length} samples)
- **Codecs:** Video: \`${detectedVideoCodec}\` | Audio: \`${detectedAudioCodec}\`
- **Simulcast:** \`${detectedSimulcast}\` | **Streams:** \`${detectedStreamSummary}\`
- **Start Time:** ${processedMetrics[0]?.kstLabel} | **End Time:** ${processedMetrics[processedMetrics.length - 1]?.kstLabel}

#### 1. Overall Session Performance
| Metric | Average | Peak | Unit |
|---|---|---|---|
| **Local Send Bitrate (Tx)** | ${sendAvg.toLocaleString()} | ${sendMax.toLocaleString()} | kbps |
| **Remote Recv Bitrate (Rx)** | ${recvAvg.toLocaleString()} | ${recvMax.toLocaleString()} | kbps |
| **Transport RTT** | ${rttAvg} | ${rttMax} | ms |
| **Remote Peer Jitter** | ${jitterAvg} | ${jitters.length ? Math.max(...jitters) : 0} | ms |
| **Packet Loss Rate** | ${lossAvg} | ${Math.max(...losses)} | % |
| **Frames Dropped** | ${totalDropped} | - | frames |

#### 2. 👤 내 로컬 송신 스트림 (Local Me Outbound - Tx)
| Stream | Kind | Max Res | Active Interval | Avg Bitrate | Jitter | Avg FPS | Total Tx |
|---|---|---|---|---|---|---|---|
${buildStreamRows(localStreams, true)}
#### 3. 👥 원격 피어 수신 스트림 (Remote Peers Inbound - Rx)
| Stream | Kind | Max Res | Active Interval | Avg Bitrate | Avg Jitter | Avg FPS | Total Rx |
|---|---|---|---|---|---|---|---|
${buildStreamRows(remoteStreams, false)}
#### 4. ⚙️ SFU 시스템 프로빙 트래픽 (SFU Probator - Rx)
| Stream | Kind | Max Res | Active Interval | Avg Bitrate | Avg Jitter | Avg FPS | Total Rx |
|---|---|---|---|---|---|---|---|
${buildStreamRows(probeStreams, false)}
*Generated by KAU WebRTC Client Telemetry Dashboard (Role-Separated)*
`;
		// <KAU> 2026-09-29 END: 마크다운 리포트에 최대 해상도 컬럼 추가

		navigator.clipboard.writeText(md).then(() => {
			showToast('역할별(내 송신/상대 피어/SFU) 마크다운 요약 리포트가 클립보드에 복사되었습니다.');
		}).catch(err => {
			alert('복사 실패: ' + err);
		});
	});
	// <KAU> 2026-09-29 END: 방안 B - 역할별 필터 이벤트 및 마크다운 리포트 생성

	btnExportCharts.addEventListener('click', () => {
		if (!bitrateChart) {
			showToast('먼저 데이터를 로드해주세요.');
			return;
		}

		const charts = [
			{ chart: bitrateChart, name: '01_webrtc_multipeer_bitrate.png' },
			{ chart: latencyChart, name: '02_webrtc_perpeer_latency_jitter.png' },
			{ chart: lossChart, name: '03_webrtc_loss_recovery.png' },
			{ chart: videoChart, name: '04_webrtc_perpeer_video_fps.png' },
		];

		charts.forEach((c, idx) => {
			setTimeout(() => {
				const url = c.chart.getDataURL({
					type: 'png',
					pixelRatio: 2,
					backgroundColor: '#060913',
				});
				const a = document.createElement('a');
				a.href = url;
				a.download = `${currentRoomId}_${c.name}`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
			}, idx * 250);
		});

		showToast('4개의 고해상도 다중 피어 차트 이미지를 다운로드합니다.');
	});

	window.addEventListener('resize', () => {
		[bitrateChart, latencyChart, lossChart, videoChart].forEach(chart => {
			if (chart) chart.resize();
		});
	});
})();
