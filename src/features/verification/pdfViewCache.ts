// PDF ビューア素材（バイナリ → pdfjs → テキスト層）の遅延ローダー + LRU キャッシュ
// （issue #28 案3: 検証パネルの初期表示で study 配下の全 PDF を読まないようにする）。
//
// 検証パネル（S6 埋め込み / S8 単独）は study 配下の全文書ではなく、表示中の 1 文書だけを
// このキャッシュ経由で読み込む。読込は documentId 単位で in-flight を重複排除し、
// 直近に読んだ PDF_CACHE_SIZE 件だけを保持する（あふれた分は pdfjs の destroy を呼ぶ）。
// 読込失敗（pdfError）もキャッシュに残す（同じ文書へ戻るたびに再フェッチしないため）が、
// retry() で明示的に捨てて読み直せる。
import type { TextLayerPage } from '../../domain/textLayer';
import type { DisposablePdfDocument } from '../documents/extractTextLayer';
import { getFileBinary } from '../../lib/google/drive';
import type { GoogleApiDeps } from '../../lib/google/types';
import type { PdfViewerDocument, RenderablePdfPage } from '../../lib/pdf/renderPage';
import { extractTextLayerPages } from '../../lib/pdf/textLayer';

/** 直近にロードした文書をキャッシュする件数（あふれた分から pdfjs を破棄する） */
export const PDF_CACHE_SIZE = 3;

/** 検証パネルが 1 文書ぶんの PDF ビューアに必要な素材 */
export interface LoadedPdfView {
  pdf: PdfViewerDocument | null;
  pdfError: string | null;
  textPages: readonly TextLayerPage[];
}

export interface PdfViewCacheDeps {
  google: GoogleApiDeps;
  /** lib/pdf/loadPdf.ts（テストは fake で完結させるため注入） */
  loadPdf: (data: ArrayBuffer) => Promise<DisposablePdfDocument>;
}

export interface PdfViewCache {
  /**
   * documentId の PDF ビューア素材を読み込む。キャッシュ済みならそれを返し（LRU の直近扱いへ更新）、
   * 読込中の documentId への重複呼び出しは同じ Promise を共有する（in-flight 重複排除）。
   * このメソッド自体は throw しない（失敗は pdfError を持つ LoadedPdfView として返る）
   */
  load(documentId: string, driveFileId: string): Promise<LoadedPdfView>;
  /**
   * documentId のキャッシュを捨てて読み直す（読込失敗からの再試行 UI 用）。
   * 読込中であればその完了を待ってから読み直す
   */
  retry(documentId: string, driveFileId: string): Promise<LoadedPdfView>;
  /** 全キャッシュ + 読込中の完了を待ってから pdfjs を破棄する（study 切替・パネル破棄時） */
  disposeAll(): Promise<void>;
}

interface CacheEntry {
  view: LoadedPdfView;
  /** 読込成功時の破棄ハンドル（失敗時は破棄対象がないため null） */
  disposable: DisposablePdfDocument | null;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** DisposablePdfDocument → ビューア用の最小形。render の viewport 型は実体が同一のため安全 */
function toViewerDocument(pdf: DisposablePdfDocument): PdfViewerDocument {
  return {
    numPages: pdf.numPages,
    getPage: (pageNumber) => pdf.getPage(pageNumber) as unknown as Promise<RenderablePdfPage>,
  };
}

export function createPdfViewCache(deps: PdfViewCacheDeps): PdfViewCache {
  // Map の挿入順を LRU 順として使う（触れるたびに delete → set し直して末尾＝最新にする）
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<LoadedPdfView>>();

  async function destroyEntry(entry: CacheEntry): Promise<void> {
    if (entry.disposable !== null) {
      await entry.disposable.destroy();
    }
  }

  /**
   * キャッシュが上限を超えていたら、最も長く触れていないものから破棄する。
   * while 条件（cache.size > PDF_CACHE_SIZE ≥ 0）が成り立つ間は cache.size > 0 が保証されるため、
   * Map の先頭キーは必ず存在する
   */
  async function evictOverflow(): Promise<void> {
    while (cache.size > PDF_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value as string;
      const entry = cache.get(oldestKey) as CacheEntry;
      cache.delete(oldestKey);
      await destroyEntry(entry);
    }
  }

  async function fetchFresh(documentId: string, driveFileId: string): Promise<LoadedPdfView> {
    let view: LoadedPdfView;
    let disposable: DisposablePdfDocument | null = null;
    try {
      const binary = await getFileBinary(driveFileId, deps.google);
      const disp = await deps.loadPdf(binary);
      const textPages = await extractTextLayerPages(disp);
      disposable = disp;
      view = { pdf: toViewerDocument(disp), pdfError: null, textPages };
    } catch (err) {
      view = { pdf: null, pdfError: toMessage(err), textPages: [] };
    }
    cache.set(documentId, { view, disposable });
    await evictOverflow();
    return view;
  }

  function load(documentId: string, driveFileId: string): Promise<LoadedPdfView> {
    const cached = cache.get(documentId);
    if (cached !== undefined) {
      // LRU: 直近アクセスとして末尾（= 最新）へ移す
      cache.delete(documentId);
      cache.set(documentId, cached);
      return Promise.resolve(cached.view);
    }
    const pending = inFlight.get(documentId);
    if (pending !== undefined) {
      return pending;
    }
    const promise = fetchFresh(documentId, driveFileId).finally(() => {
      inFlight.delete(documentId);
    });
    inFlight.set(documentId, promise);
    return promise;
  }

  async function retry(documentId: string, driveFileId: string): Promise<LoadedPdfView> {
    const pending = inFlight.get(documentId);
    if (pending !== undefined) {
      await pending;
    }
    // 失敗キャッシュ（disposable なし）はもちろん、成功キャッシュの明示的な再取得も許す
    cache.delete(documentId);
    return load(documentId, driveFileId);
  }

  async function disposeAll(): Promise<void> {
    await Promise.all([...inFlight.values()]);
    const entries = [...cache.values()];
    cache.clear();
    for (const entry of entries) {
      await destroyEntry(entry);
    }
  }

  return { load, retry, disposeAll };
}
