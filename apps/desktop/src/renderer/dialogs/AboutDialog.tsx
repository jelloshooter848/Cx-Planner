import { Modal } from '../components/Modal';
import { useStore } from '../store';

/** Help > About. */
export function AboutDialog() {
  const store = useStore();
  const close = () => store.closeDialog();
  return (
    <Modal title="About Cx Planner" onClose={close} width={400}>
      <p>Planning for electrical QA/QC and commissioning: schedules, templates, look-ahead prints and test sheets.</p>
      <p className="hint">Every edit is saved to the project file as you go. Undo and redo with Ctrl+Z and Ctrl+Y.</p>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={close}>
          OK
        </button>
      </div>
    </Modal>
  );
}
