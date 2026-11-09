/**
 * The asset properties form, shown in the Schedule view's right-hand panel when an asset's
 * group row is selected. Each field commits on blur or Enter as one updateAsset command
 * (one undo step). The tag is checked here first: it can't be empty or repeat another
 * asset's tag (trimmed, case-insensitive), as core's updateAsset also insists.
 */
import { assetTagProblem, type Asset, type AssetPatch, type Project } from '@cx/core';
import { plural } from '../../format';
import { useStore } from '../../store';
import { edit, Field, type Commit } from './PanelField';

export function AssetPanelBody({ asset, project }: { asset: Asset; project: Project }) {
  const store = useStore();
  const update = (patch: AssetPatch) => edit(store, { kind: 'updateAsset', id: asset.id, patch });
  const taskCount = project.tasks.reduce((n, t) => (t.assetId === asset.id ? n + 1 : n), 0);
  const index = project.assets.findIndex((a) => a.id === asset.id);

  const commitTag: Commit = async (raw) => {
    const tag = raw.trim();
    if (tag === asset.tag) return null;
    const problem = assetTagProblem(project, asset.id, tag);
    return problem ?? update({ tag });
  };
  /** Description is required by the model (it may be empty); location and system are optional. */
  const text =
    (key: 'description' | 'location' | 'system'): Commit =>
    async (raw) => {
      const value = raw.trim();
      if (value === (asset[key] ?? '')) return null;
      if (key === 'description') return update({ description: value });
      return update({ [key]: value === '' ? null : value });
    };

  return (
    <div className="task-panel-body" data-asset-id={asset.id}>
      <h2 className="task-panel-head">
        Asset {index + 1} · {plural(taskCount, 'task')}
      </h2>
      <Field label="Tag" value={asset.tag} commit={commitTag} name="asset-tag" />
      <Field label="Description" value={asset.description} commit={text('description')} name="asset-description" />
      <Field label="Location" value={asset.location ?? ''} commit={text('location')} name="asset-location" placeholder="e.g. Elec Room 101" />
      <Field label="System" value={asset.system ?? ''} commit={text('system')} name="asset-system" placeholder="e.g. Normal power" />
      <p className="field-hint">Changes save as you leave each field. Ctrl+Z undoes them.</p>
      <div className="task-panel-actions">
        <button type="button" className="btn" onClick={() => void store.dispatch({ type: 'delete-asset' })}>
          Delete asset…
        </button>
      </div>
    </div>
  );
}
