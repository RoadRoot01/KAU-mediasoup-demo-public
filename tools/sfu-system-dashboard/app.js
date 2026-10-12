/**
 * KAU SFU System Metrics Dashboard - app.js
 * High-performance interactive dashboard using Vanilla JS and Apache ECharts
 */

(() => {
	'use strict';

	// State
	let currentData = [];
	let currentFileName = '';
	let timeAxisMode = 'elapsed'; // 'elapsed' | 'timestamp'
	let cpuChart = null;
	let ramChart = null;
	let hwChart = null;
	let isTableCollapsed = true;

	// DOM Elements
	const dropZone = document.getElementById('dropZone');
	const csvFileInput = document.getElementById('csvFileInput');
	const dashboardContent = document.getElementById('dashboardContent');
	const fileInfoBadge = document.getElementById('fileInfoBadge');
	const fileNameDisplay = document.getElementById('fileNameDisplay');
	const fileSampleCount = document.getElementById('fileSampleCount');
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

	// Toast Helper
	let toastTimeout = null;
	function showToast(message, duration = 3000) {
		if (toastTimeout) {
			clearTimeout(toastTimeout);
		}
		toastNotification.textContent = message;
		toastNotification.classList.remove('hidden');
		toastTimeout = setTimeout(() => {
			toastNotification.classList.add('hidden');
		}, duration);
	}

	// 1. CSV Parser (Robust standalone implementation)
	function parseCSV(text) {
		const lines = text.trim().split(/\r?\n/);
		if (lines.length < 2) {
			throw new Error('CSV 파일에 데이터가 충분하지 않습니다.');
		}

		const headers = lines[0].split(',').map(h => h.trim());
		const rows = [];

		for (let i = 1; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line) continue;

			const parts = line.split(',').map(p => p.trim());
			const row = {};

			headers.forEach((header, index) => {
				const val = parts[index];
				if (header === 'timestamp') {
					row[header] = val;
				} else if (val === '' || val === undefined || isNaN(Number(val))) {
					row[header] = null;
				} else {
					row[header] = Number(val);
				}
			});

			rows.push(row);
		}

		return rows;
	}

	// Helper: Format KST timestamp for axis (HH:mm:ss)
	function formatTimeLabel(isoString) {
		if (!isoString) return '';
		try {
			// e.g. "2026-09-28T20:44:51.415+09:00" or UTC "2026-09-28T11:44:51.415Z"
			const d = new Date(isoString);
			if (isNaN(d.getTime())) {
				// Fallback substring extraction
				const match = isoString.match(/(\d{2}:\d{2}:\d{2})/);
				return match ? match[1] : isoString;
			}
			// Display as HH:mm:ss in KST
			const formatter = new Intl.DateTimeFormat('ko-KR', {
				timeZone: 'Asia/Seoul',
				hour12: false,
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
			});
			return formatter.format(d);
		} catch {
			return isoString;
		}
	}

	// 2. Calculate Stats & Update KPIs
	function updateKPIs(data) {
		if (!data || data.length === 0) return;

		const samples = data.length;
		const maxElapsed = Math.max(...data.map(d => d.elapsed_sec || 0));
		const minutes = Math.floor(maxElapsed / 60);
		const seconds = maxElapsed % 60;
		const durationText = `${minutes > 0 ? minutes + '분 ' : ''}${seconds}초`;
		document.getElementById('valDurationText').textContent = durationText;

		// SFU CPU
		const sfuCpus = data.map(d => d.cpu_sfu_total_pct || 0);
		const sfuCpuPeak = Math.max(...sfuCpus);
		const sfuCpuAvg = (sfuCpus.reduce((a, b) => a + b, 0) / samples).toFixed(1);
		const sfuRams = data.map(d => d.ram_sfu_rss_mb || 0);
		const sfuRamPeak = Math.max(...sfuRams).toFixed(1);

		document.getElementById('kpiSfuCpuPeak').textContent = sfuCpuPeak.toFixed(1);
		document.getElementById('kpiSfuCpuAvg').textContent = `${sfuCpuAvg}%`;
		document.getElementById('kpiSfuRamPeak').textContent = `${sfuRamPeak} MB`;
		document.getElementById('kpiSfuCpuBar').style.width = `${Math.min(100, sfuCpuPeak)}%`;

		// Chrome Load
		const chromeCpus = data.map(d => d.cpu_chrome_pct || 0);
		const chromeCpuPeak = Math.max(...chromeCpus);
		const chromeRams = data.map(d => d.ram_chrome_mb || 0);
		const chromeRamPeak = Math.max(...chromeRams).toFixed(0);
		const chromeProcs = Math.max(...data.map(d => d.chrome_procs || 0));

		document.getElementById('kpiChromeCpuPeak').textContent = chromeCpuPeak.toFixed(1);
		document.getElementById('kpiChromeRamPeak').textContent = `${chromeRamPeak} MB`;
		document.getElementById('kpiChromeProcs').textContent = `${chromeProcs}개`;
		document.getElementById('kpiChromeCpuBar').style.width = `${Math.min(100, chromeCpuPeak)}%`;

		// Host System
		const sysCpus = data.map(d => d.cpu_system_pct || 0);
		const sysCpuPeak = Math.max(...sysCpus);
		const sysRamPcts = data.map(d => d.ram_pct || 0);
		const sysRamPeak = Math.max(...sysRamPcts);
		const sysRamUsed = Math.max(...data.map(d => d.ram_used_mb || 0));

		document.getElementById('kpiSysCpuPeak').textContent = sysCpuPeak.toFixed(1);
		document.getElementById('kpiSysRamPeak').textContent = `${sysRamPeak.toFixed(1)}%`;
		document.getElementById('kpiSysRamUsedPeak').textContent = `${sysRamUsed} MB`;
		document.getElementById('kpiSysCpuBar').style.width = `${Math.min(100, sysCpuPeak)}%`;

		// Hardware & Thermal
		const temps = data.map(d => d.cpu_temp_c).filter(v => v !== null && v > 0);
		const tempPeak = temps.length > 0 ? Math.max(...temps).toFixed(1) : 'N/A';
		const gpus = data.map(d => d.gpu_pct).filter(v => v !== null && v >= 0);
		const gpuPeak = gpus.length > 0 ? Math.max(...gpus).toFixed(0) : '0';

		const batteries = data.map(d => d.battery_pct).filter(v => v !== null);
		let batteryDelta = '0';
		if (batteries.length > 1) {
			const battStart = batteries[0];
			const battEnd = batteries[batteries.length - 1];
			batteryDelta = (battStart - battEnd).toFixed(0);
		}

		document.getElementById('kpiCpuTempPeak').textContent = tempPeak;
		document.getElementById('kpiGpuPeak').textContent = `${gpuPeak}%`;
		document.getElementById('kpiBatteryDelta').textContent = `${batteryDelta}%`;
		const tempBarPct = tempPeak !== 'N/A' ? Math.min(100, (Number(tempPeak) / 100) * 100) : 0;
		document.getElementById('kpiTempBar').style.width = `${tempBarPct}%`;
	}

	// 3. ECharts Setup & Render
	function initCharts() {
		if (cpuChart) cpuChart.dispose();
		if (ramChart) ramChart.dispose();
		if (hwChart) hwChart.dispose();

		const commonGrid = {
			left: '55px',
			right: '55px',
			top: '30px',
			bottom: '60px',
		};

		// 1) CPU Chart
		cpuChart = echarts.init(document.getElementById('cpuChart'), 'dark');
		// 2) RAM Chart
		ramChart = echarts.init(document.getElementById('ramChart'), 'dark');
		// 3) Hardware Chart
		hwChart = echarts.init(document.getElementById('hwChart'), 'dark');

		// Sync tooltip & crosshair between all 3 charts!
		echarts.connect([cpuChart, ramChart, hwChart]);

		window.addEventListener('resize', () => {
			cpuChart && cpuChart.resize();
			ramChart && ramChart.resize();
			hwChart && hwChart.resize();
		});
	}

	function renderCharts(data) {
		if (!data || data.length === 0) return;

		// X Axis values
		const xValues = data.map(d => {
			if (timeAxisMode === 'timestamp') {
				return formatTimeLabel(d.timestamp);
			}
			return `${d.elapsed_sec}s`;
		});

		// Theme tokens
		const theme = {
			textColor: '#94a3b8',
			borderColor: 'rgba(255, 255, 255, 0.08)',
			bgTooltip: 'rgba(15, 23, 42, 0.95)',
		};

		const commonXAxis = {
			type: 'category',
			data: xValues,
			boundaryGap: false,
			axisLine: { lineStyle: { color: theme.borderColor } },
			axisLabel: { color: theme.textColor, fontFamily: 'JetBrains Mono', fontSize: 11 },
			axisTick: { alignWithLabel: true },
		};

		const commonTooltip = {
			trigger: 'axis',
			backgroundColor: theme.bgTooltip,
			borderColor: 'rgba(56, 189, 248, 0.3)',
			borderWidth: 1,
			textStyle: { color: '#f8fafc', fontFamily: 'JetBrains Mono', fontSize: 12 },
			axisPointer: {
				type: 'cross',
				lineStyle: { color: 'rgba(56, 189, 248, 0.4)', type: 'dashed' },
			},
		};

		// Chart 1: CPU Load
		const cpuOption = {
			backgroundColor: 'transparent',
			tooltip: commonTooltip,
			grid: { left: '55px', right: '55px', top: '35px', bottom: '25px' },
			xAxis: commonXAxis,
			yAxis: {
				type: 'value',
				name: '사용률 (%)',
				min: 0,
				max: val => Math.min(100, Math.ceil(val.max * 1.15) || 100),
				axisLabel: { color: theme.textColor, formatter: '{value}%', fontFamily: 'JetBrains Mono' },
				splitLine: { lineStyle: { color: theme.borderColor } },
			},
			series: [
				{
					name: 'System CPU %',
					type: 'line',
					smooth: true,
					data: data.map(d => d.cpu_system_pct),
					itemStyle: { color: '#38bdf8' },
					lineStyle: { width: 2 },
					areaStyle: {
						color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
							{ offset: 0, color: 'rgba(56, 189, 248, 0.25)' },
							{ offset: 1, color: 'rgba(56, 189, 248, 0.0)' },
						]),
					},
				},
				{
					name: 'SFU Total CPU %',
					type: 'line',
					smooth: true,
					data: data.map(d => d.cpu_sfu_total_pct),
					itemStyle: { color: '#10b981' },
					lineStyle: { width: 3 },
					areaStyle: {
						color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
							{ offset: 0, color: 'rgba(16, 185, 129, 0.35)' },
							{ offset: 1, color: 'rgba(16, 185, 129, 0.0)' },
						]),
					},
				},
				{
					name: 'Chrome CPU %',
					type: 'line',
					smooth: true,
					data: data.map(d => d.cpu_chrome_pct),
					itemStyle: { color: '#a855f7' },
					lineStyle: { width: 2 },
				},
			],
		};

		// Chart 2: RAM Memory
		const ramOption = {
			backgroundColor: 'transparent',
			tooltip: commonTooltip,
			grid: { left: '55px', right: '55px', top: '35px', bottom: '25px' },
			xAxis: commonXAxis,
			yAxis: [
				{
					type: 'value',
					name: '메모리 (MB)',
					position: 'left',
					axisLabel: { color: theme.textColor, formatter: '{value} MB', fontFamily: 'JetBrains Mono' },
					splitLine: { lineStyle: { color: theme.borderColor } },
				},
				{
					type: 'value',
					name: '시스템 RAM (%)',
					position: 'right',
					min: 0,
					max: 100,
					axisLabel: { color: theme.textColor, formatter: '{value}%', fontFamily: 'JetBrains Mono' },
					splitLine: { show: false },
				},
			],
			series: [
				{
					name: 'Chrome RAM (MB)',
					type: 'line',
					smooth: true,
					yAxisIndex: 0,
					data: data.map(d => d.ram_chrome_mb),
					itemStyle: { color: '#a855f7' },
					lineStyle: { width: 2 },
				},
				{
					name: 'SFU RSS (MB)',
					type: 'line',
					smooth: true,
					yAxisIndex: 0,
					data: data.map(d => d.ram_sfu_rss_mb),
					itemStyle: { color: '#10b981' },
					lineStyle: { width: 2.5 },
				},
				{
					name: 'System RAM %',
					type: 'line',
					smooth: true,
					yAxisIndex: 1,
					data: data.map(d => d.ram_pct),
					itemStyle: { color: '#38bdf8' },
					lineStyle: { width: 1.5, type: 'dashed' },
				},
			],
		};

		// Chart 3: Hardware Environment (GPU / Temp / Battery / Chrome Count)
		const hwOption = {
			backgroundColor: 'transparent',
			tooltip: commonTooltip,
			grid: { left: '55px', right: '55px', top: '35px', bottom: '65px' },
			xAxis: commonXAxis,
			yAxis: [
				{
					type: 'value',
					name: '% / °C',
					position: 'left',
					axisLabel: { color: theme.textColor, fontFamily: 'JetBrains Mono' },
					splitLine: { lineStyle: { color: theme.borderColor } },
				},
				{
					type: 'value',
					name: '프로세스 수',
					position: 'right',
					min: 0,
					axisLabel: { color: theme.textColor, formatter: '{value}개', fontFamily: 'JetBrains Mono' },
					splitLine: { show: false },
				},
			],
			// Include master DataZoom in bottom chart
			dataZoom: [
				{
					type: 'slider',
					xAxisIndex: [0],
					bottom: '15px',
					height: '24px',
					borderColor: 'rgba(255, 255, 255, 0.1)',
					backgroundColor: 'rgba(15, 23, 42, 0.8)',
					fillerColor: 'rgba(56, 189, 248, 0.2)',
					handleStyle: { color: '#38bdf8', borderColor: '#ffffff' },
					textStyle: { color: theme.textColor, fontFamily: 'JetBrains Mono' },
				},
				{
					type: 'inside',
					xAxisIndex: [0],
				},
			],
			series: [
				{
					name: 'GPU %',
					type: 'line',
					smooth: true,
					data: data.map(d => d.gpu_pct),
					itemStyle: { color: '#06b6d4' },
					lineStyle: { width: 2 },
				},
				{
					name: 'CPU Temp °C',
					type: 'line',
					smooth: true,
					data: data.map(d => d.cpu_temp_c),
					itemStyle: { color: '#f59e0b' },
					lineStyle: { width: 2.5 },
				},
				{
					name: 'Battery %',
					type: 'line',
					smooth: true,
					data: data.map(d => d.battery_pct),
					itemStyle: { color: '#ec4899' },
					lineStyle: { width: 1.5, type: 'dotted' },
				},
				{
					name: 'Chrome Procs',
					type: 'bar',
					yAxisIndex: 1,
					data: data.map(d => d.chrome_procs),
					itemStyle: { color: 'rgba(148, 163, 184, 0.35)', borderRadius: [4, 4, 0, 0] },
					barMaxWidth: 16,
				},
			],
		};

		cpuChart.setOption(cpuOption, true);
		ramChart.setOption(ramOption, true);
		hwChart.setOption(hwOption, true);

		// Link DataZoom events to cpuChart and ramChart as well
		hwChart.off('datazoom');
		hwChart.on('datazoom', params => {
			const zoomOpt = {
				dataZoom: [
					{
						start: params.start !== undefined ? params.start : params.batch?.[0]?.start,
						end: params.end !== undefined ? params.end : params.batch?.[0]?.end,
					},
				],
			};
			cpuChart.setOption(zoomOpt);
			ramChart.setOption(zoomOpt);
		});
	}

	// 4. Populate Data Table
	function populateTable(data) {
		tableRowsCount.textContent = data.length;
		dataTableBody.innerHTML = '';

		const fragment = document.createDocumentFragment();
		data.forEach((row, idx) => {
			const tr = document.createElement('tr');
			const kstTime = formatTimeLabel(row.timestamp);
			tr.innerHTML = `
				<td>${idx + 1}</td>
				<td>${kstTime}</td>
				<td>${row.elapsed_sec ?? '-'}</td>
				<td><strong>${row.cpu_system_pct ?? '-'}%</strong></td>
				<td style="color:#34d399">${row.cpu_sfu_total_pct ?? '-'}%</td>
				<td style="color:#c084fc">${row.cpu_chrome_pct ?? '-'}%</td>
				<td>${row.ram_sfu_rss_mb ?? '-'}</td>
				<td>${row.ram_chrome_mb ?? '-'}</td>
				<td>${row.ram_pct ?? '-'}%</td>
				<td>${row.gpu_pct !== null ? row.gpu_pct + '%' : '-'}</td>
				<td style="color:#fbbf24">${row.cpu_temp_c !== null ? row.cpu_temp_c + '°C' : '-'}</td>
				<td>${row.battery_pct !== null ? row.battery_pct + '%' : '-'}</td>
				<td>${row.chrome_procs ?? '-'}</td>
			`;
			fragment.appendChild(tr);
		});

		dataTableBody.appendChild(fragment);
	}

	// 5. Main Process Data
	function processData(csvText, fileName = 'metrics.csv') {
		try {
			const rows = parseCSV(csvText);
			if (rows.length === 0) {
				showToast('CSV 데이터가 비어있습니다.');
				return;
			}

			currentData = rows;
			currentFileName = fileName;

			// Update header info
			fileNameDisplay.textContent = fileName;
			fileSampleCount.textContent = `${rows.length}개 샘플`;
			fileInfoBadge.classList.remove('hidden');

			// Hide dropzone, show dashboard
			dropZone.classList.add('hidden');
			dashboardContent.classList.remove('hidden');

			// Init & render
			initCharts();
			updateKPIs(currentData);
			renderCharts(currentData);
			populateTable(currentData);

			showToast(`성공적으로 ${rows.length}개의 측정 데이터를 불러왔습니다.`);
		} catch (err) {
			console.error('Failed to parse CSV:', err);
			showToast(`CSV 파싱 오류: ${err.message}`);
		}
	}

	// 6. Event Handlers
	function setupEvents() {
		// File input
		csvFileInput.addEventListener('change', e => {
			const file = e.target.files?.[0];
			if (!file) return;

			const reader = new FileReader();
			reader.onload = evt => {
				processData(evt.target.result, file.name);
			};
			reader.readAsText(file, 'utf-8');
		});

		// Drag and Drop
		['dragenter', 'dragover'].forEach(eventName => {
			document.body.addEventListener(eventName, e => {
				e.preventDefault();
				e.stopPropagation();
				dropZone.classList.add('dragover');
			});
		});

		['dragleave', 'drop'].forEach(eventName => {
			document.body.addEventListener(eventName, e => {
				e.preventDefault();
				e.stopPropagation();
				dropZone.classList.remove('dragover');
			});
		});

		document.body.addEventListener('drop', e => {
			e.preventDefault();
			e.stopPropagation();
			const dt = e.dataTransfer;
			const file = dt.files?.[0];
			if (file && file.name.endsWith('.csv')) {
				const reader = new FileReader();
				reader.onload = evt => {
					processData(evt.target.result, file.name);
				};
				reader.readAsText(file, 'utf-8');
			} else {
				showToast('올바른 .csv 파일을 드롭해주세요.');
			}
		});

		// Time axis toggle
		btnXAxisSec.addEventListener('click', () => {
			if (timeAxisMode === 'elapsed') return;
			timeAxisMode = 'elapsed';
			btnXAxisSec.classList.add('active');
			btnXAxisKst.classList.remove('active');
			renderCharts(currentData);
		});

		btnXAxisKst.addEventListener('click', () => {
			if (timeAxisMode === 'timestamp') return;
			timeAxisMode = 'timestamp';
			btnXAxisKst.classList.add('active');
			btnXAxisSec.classList.remove('active');
			renderCharts(currentData);
		});

		// Reset Zoom
		btnResetZoom.addEventListener('click', () => {
			if (!hwChart || !currentData.length) return;
			const resetOpt = {
				dataZoom: [{ start: 0, end: 100 }],
			};
			cpuChart.setOption(resetOpt);
			ramChart.setOption(resetOpt);
			hwChart.setOption(resetOpt);
			showToast('차트 줌이 리셋되었습니다.');
		});

		// Copy Markdown Summary
		btnCopySummary.addEventListener('click', () => {
			if (!currentData || currentData.length === 0) {
				showToast('복사할 데이터가 없습니다.');
				return;
			}

			const sfuPeak = document.getElementById('kpiSfuCpuPeak').textContent;
			const sfuAvg = document.getElementById('kpiSfuCpuAvg').textContent;
			const sfuRam = document.getElementById('kpiSfuRamPeak').textContent;
			const chromePeak = document.getElementById('kpiChromeCpuPeak').textContent;
			const chromeRam = document.getElementById('kpiChromeRamPeak').textContent;
			const sysCpu = document.getElementById('kpiSysCpuPeak').textContent;
			const sysRam = document.getElementById('kpiSysRamPeak').textContent;
			const tempPeak = document.getElementById('kpiCpuTempPeak').textContent;
			const duration = document.getElementById('valDurationText').textContent;

			const mdReport = [
				`### 📊 KAU SFU 부하 및 리소스 측정 리포트 (${currentFileName})`,
				`- **측정 지속 시간**: ${duration} (${currentData.length}개 샘플, 5초 주기)`,
				'',
				'| 항목 | 피크 수치 (Peak) | 평균 / 상세 |',
				'| :--- | :--- | :--- |',
				`| **SFU Core CPU** | **${sfuPeak}%** | 평균 ${sfuAvg} (Node + mediasoup-worker) |`,
				`| **SFU RAM (RSS)** | **${sfuRam}** | SFU 프로세스 점유 |`,
				`| **Chrome CPU** | **${chromePeak}%** | 클라이언트 브라우저 부하 |`,
				`| **Chrome RAM** | **${chromeRam}** | 브라우저 탭/렌더러 메모리 |`,
				`| **Host System CPU** | **${sysCpu}%** | 호스트 전체 CPU 피크 |`,
				`| **Host System RAM** | **${sysRam}** | 호스트 전체 RAM 사용률 |`,
				`| **CPU 최고 온도** | **${tempPeak}°C** | 하드웨어 발열 |`,
			].join('\n');

			navigator.clipboard
				.writeText(mdReport)
				.then(() => {
					showToast('마크다운 요약 리포트가 클립보드에 복사되었습니다!');
				})
				.catch(() => {
					showToast('클립보드 복사 권한이 거부되었습니다.');
				});
		});

		// Export Chart as PNG
		btnExportCharts.addEventListener('click', () => {
			if (!cpuChart) {
				showToast('저장할 차트가 없습니다.');
				return;
			}
			try {
				const url = cpuChart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#0b0f19' });
				const link = document.createElement('a');
				link.download = `sfu_cpu_chart_${Date.now()}.png`;
				link.href = url;
				link.click();
				showToast('CPU 차트 이미지가 다운로드되었습니다.');
			} catch (err) {
				console.error(err);
				showToast('이미지 저장 중 오류가 발생했습니다.');
			}
		});

		// Table toggle
		tableToggleBtn.addEventListener('click', () => {
			isTableCollapsed = !isTableCollapsed;
			if (isTableCollapsed) {
				tableContentWrapper.classList.add('collapsed');
				tableChevron.style.transform = 'rotate(-90deg)';
			} else {
				tableContentWrapper.classList.remove('collapsed');
				tableChevron.style.transform = 'rotate(0deg)';
			}
		});

		// Load Demo Sample
		btnLoadDemo.addEventListener('click', () => {
			loadDemoData();
		});
	}

	// 7. Demo Data Generator (For instant testing without file)
	function loadDemoData() {
		const sampleRows = [];
		const now = Date.now();
		for (let i = 0; i <= 60; i++) {
			const elapsed = i * 5;
			const time = new Date(now - (60 - i) * 5000 + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00');
			// Simulate ramp-up
			const sfuCpu = +(Math.sin(i / 10) * 12 + i * 0.4 + 2).toFixed(1);
			const chromeCpu = +(Math.cos(i / 8) * 8 + i * 0.3 + 5).toFixed(1);
			const sysCpu = +(sfuCpu + chromeCpu + 15 + Math.random() * 5).toFixed(1);
			const sfuRam = +(65 + i * 0.25).toFixed(1);
			const chromeRam = +(1800 + i * 15).toFixed(1);
			const sysRamPct = +(48 + i * 0.1).toFixed(1);
			const gpuPct = i % 5 === 0 ? Math.floor(Math.random() * 30) : 0;
			const temp = +(62 + (i / 60) * 8).toFixed(1);
			const battery = Math.max(20, 80 - Math.floor(i / 20));
			const procs = 18 + Math.floor(i / 15);

			sampleRows.push({
				timestamp: time,
				elapsed_sec: elapsed,
				cpu_system_pct: Math.min(100, sysCpu),
				cpu_sfu_total_pct: Math.min(100, sfuCpu),
				cpu_chrome_pct: Math.min(100, chromeCpu),
				ram_used_mb: Math.round(16000 + i * 50),
				ram_total_mb: 32280,
				ram_pct: sysRamPct,
				ram_sfu_rss_mb: sfuRam,
				ram_chrome_mb: chromeRam,
				chrome_procs: procs,
				gpu_pct: gpuPct,
				cpu_temp_c: temp,
				battery_pct: battery,
			});
		}

		currentData = sampleRows;
		currentFileName = 'demo_load_benchmark.csv';

		fileNameDisplay.textContent = currentFileName;
		fileSampleCount.textContent = `${sampleRows.length}개 샘플 (데모)`;
		fileInfoBadge.classList.remove('hidden');

		dropZone.classList.add('hidden');
		dashboardContent.classList.remove('hidden');

		initCharts();
		updateKPIs(currentData);
		renderCharts(currentData);
		populateTable(currentData);

		showToast('데모 시뮬레이션 데이터를 성공적으로 로드했습니다.');
	}

	// Initialization
	document.addEventListener('DOMContentLoaded', () => {
		setupEvents();
	});
})();
