import { useStore, useUi } from '../store';

/** The last failure the user has not seen in a dialog (e.g. an edit the main process refused). */
export function NoticeBar() {
  const store = useStore();
  const notice = useUi().notice;
  if (!notice) return null;
  return (
    <div className="notice" role="alert" key={notice.id}>
      <span className="notice-mark" aria-hidden="true">!</span>
      <span className="notice-text">{notice.message}</span>
      <button type="button" className="btn btn-quiet" onClick={() => store.dismissNotice()}>
        Dismiss
      </button>
    </div>
  );
}
