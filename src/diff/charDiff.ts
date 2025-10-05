export interface CharDiffSegment {
	orgIdx: number;
	newIdx: number;
	text: string;
	/**
	 * Number of characters to delete. 0 or undefined if not present.
	 * If insert is empty string and delete > 0, that range represents deletion.
	 */
	delete?: number;
	/** Operation type */
	type: 'keep' | 'add' | 'delete';
}

// Represents insertion and deletion segments
export function computeCharDiff(orgText: string, newText: string): CharDiffSegment[] {
	// 1) First match common prefix/suffix parts (especially consecutive spaces) as much as possible,
	//    then analyze only the central part where differences exist using LCS.

	// --- Find length of common prefix ---
	let prefixLen = 0;
	while (prefixLen < orgText.length && prefixLen < newText.length && orgText[prefixLen] === newText[prefixLen]) {
		prefixLen++;
	}

	// --- Find length of common suffix (careful not to overlap with prefix) ---
	let suffixLen = 0;
	while (
		suffixLen < orgText.length - prefixLen &&
		suffixLen < newText.length - prefixLen &&
		orgText[orgText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
	) {
		suffixLen++;
	}

	// Central part (difference area)
	const coreOrig = orgText.slice(prefixLen, orgText.length - suffixLen);
	const coreUpdated = newText.slice(prefixLen, newText.length - suffixLen);

	const n = coreOrig.length;
	const m = coreUpdated.length;

	// --- Create LCS table ---
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			if (coreOrig[i - 1] === coreUpdated[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// --- Backtrace to generate operation sequence ---
	let i = n;
	let j = m;
	const revOps: Array<{ type: 'keep' | 'add' | 'delete'; ch?: string; iAt?: number }> = [];
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && coreOrig[i - 1] === coreUpdated[j - 1]) {
			revOps.push({ type: 'keep', ch: coreOrig[i - 1] });
			i--; j--;
		} else if (j > 0 && (i === 0 || dp[i - 1][j] <= dp[i][j - 1])) {
			revOps.push({ type: 'add', ch: coreUpdated[j - 1], iAt: i });
			j--;
		} else if (i > 0) {
			revOps.push({ type: 'delete', ch: coreOrig[i - 1] });
			i--;
		}
	}
	const ops = revOps.reverse();

	// --- Build insertion segments from operation sequence ---
	const segments: CharDiffSegment[] = [];
	// --- Buffer for insertion ---
	let currInsIdx: number | null = null; // Insertion start position (relative within core)
	let insBuffer = '';

	// --- Buffer for deletion ---
	let currDelIdx: number | null = null; // Deletion start position (relative within core)
	let delCount = 0;

	// --- Buffer for equivalent segments ---
	let currEqIdx: number | null = null;
	let eqBuffer = '';

	// Helper: flush eq
	const flushEq = () => {
		if (eqBuffer && currEqIdx !== null) {
			segments.push({ orgIdx: currEqIdx, newIdx: 0, text: eqBuffer, type: 'keep' });
			eqBuffer = '';
			currEqIdx = null;
		}
	};

	let cursorI = 0; // Position within core
	for (const op of ops) {
		if (op.type === 'keep') {
			// flush deletion (first)
			if (0 < delCount && currDelIdx !== null) {
				segments.push({ orgIdx: currDelIdx, newIdx: 0, text: '', delete: delCount, type: 'delete' });
				delCount = 0;
				currDelIdx = null;
			}
			// flush insertion
			if (insBuffer && currInsIdx !== null) {
				segments.push({ orgIdx: currInsIdx, newIdx: 0, text: insBuffer, type: 'add' });
				insBuffer = '';
				currInsIdx = null;
			}
			// accumulate eq
			if (currEqIdx === null) currEqIdx = cursorI + prefixLen;
			eqBuffer += op.ch ?? '';
			cursorI++;
		} else if (op.type === 'delete') {
			// flush eq
			flushEq();
			// accumulate deletion
			if (currDelIdx === null) currDelIdx = cursorI + prefixLen;
			delCount++;
			// Move cursor forward in original text as we've consumed one character
			cursorI++;
		} else if (op.type === 'add') {
			// flush deletion
			if (0 < delCount && currDelIdx !== null) {
				segments.push({ orgIdx: currDelIdx, newIdx: 0, text: '', delete: delCount, type: 'delete' });
				delCount = 0;
				currDelIdx = null;
			}
			// flush eq
			flushEq();
			// accumulate insertion
			const insPos = cursorI + prefixLen; // Shift position by prefix length
			if (currInsIdx === null) currInsIdx = insPos;
			insBuffer += op.ch ?? '';
		}
	}

	// Final flush
	flushEq();
	if (0 < delCount && currDelIdx !== null) {
		segments.push({ orgIdx: currDelIdx, newIdx: 0, text: '', delete: delCount, type: 'delete' });
	}
	if (insBuffer && currInsIdx !== null) {
		segments.push({ orgIdx: currInsIdx, newIdx: 0, text: insBuffer, type: 'add' });
	}

	// --- Add prefix / suffix eq to results ---
	const result: CharDiffSegment[] = [];
	if (0 < prefixLen) {
		result.push({ orgIdx: 0, newIdx: 0, text: orgText.slice(0, prefixLen), type: 'keep' });
	}
	result.push(...segments);
	if (0 < suffixLen) {
		result.push({ orgIdx: orgText.length - suffixLen, newIdx: 0, text: orgText.slice(orgText.length - suffixLen), type: 'keep' });
	}

	let newIdx = 0;
	for(const segment of result) {
		segment.newIdx = newIdx;
		if (segment.type !== 'delete') {
			newIdx += segment.text.length;
		}
	}
	return result;
}




