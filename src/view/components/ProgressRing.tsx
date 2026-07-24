// Custom SVG progress ring for percent properties and checklist N/M (M6).

export function ProgressRing({ value, size = 22 }: { value: number; size?: number }) {
	const clamped = Math.max(0, Math.min(100, value));
	const stroke = 3;
	const r = (size - stroke) / 2;
	const circumference = 2 * Math.PI * r;
	const offset = circumference * (1 - clamped / 100);
	const center = size / 2;
	return (
		<span class="eb-ring" title={`${clamped}%`}>
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				<circle
					class="eb-ring-track"
					cx={center}
					cy={center}
					r={r}
					fill="none"
					stroke-width={stroke}
				/>
				<circle
					class="eb-ring-fill"
					cx={center}
					cy={center}
					r={r}
					fill="none"
					stroke-width={stroke}
					stroke-dasharray={circumference}
					stroke-dashoffset={offset}
					stroke-linecap="round"
					transform={`rotate(-90 ${center} ${center})`}
				/>
			</svg>
			<span class="eb-ring-label">{clamped}</span>
		</span>
	);
}
