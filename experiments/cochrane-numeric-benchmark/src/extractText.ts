import { extractText } from './textLayer';
import { safeError } from './cost';

try { await extractText(); } catch (error) { console.error(safeError(error)); process.exitCode = 1; }
