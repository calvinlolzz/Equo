import { Archive } from "lucide-react";
import type { ArchivedGroupData } from "./cloudStore";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

type ArchivedListPanelProps = {
  archivedGroups: ArchivedGroupData[];
  loading: boolean;
  unarchivingGroupId: string;
  onUnarchive: (group: ArchivedGroupData) => void;
};

/** The 封存群組 bottom-sheet content: archived group rows with owner-only restore. */
export function ArchivedListPanel({ archivedGroups, loading, unarchivingGroupId, onUnarchive }: ArchivedListPanelProps) {
  return (
    <>
      <div className="dialog-header">
        <h3>{text.archivedGroups}</h3>
        <p>{"封存後的群組會放在這裡，不會出現在左側主列表。"}</p>
      </div>
      <div className="dialog-section-list archived-dialog-list">
        {loading ? (
          <div className="cloud-loading-skeleton" aria-busy="true">
            <span className="pulse-dot active" />
          </div>
        ) : archivedGroups.length ? (
          archivedGroups.map((group) => (
            <div className="archived-dialog-row" key={group.id}>
              {group.coverImageUrl ? (
                <span className="record-dialog-thumb">
                  <img src={group.coverImageUrl} alt="" />
                </span>
              ) : (
                <span className="record-dialog-icon">
                  <Archive aria-hidden="true" size={18} />
                </span>
              )}
              <span>
                <strong>{group.name}</strong>
                <small>{group.currency}</small>
              </span>
              {group.callerMemberId === group.ownerMemberId ? (
                <button
                  className="composer-mini-action"
                  type="button"
                  disabled={Boolean(unarchivingGroupId)}
                  onClick={() => onUnarchive(group)}
                >
                  {unarchivingGroupId === group.id ? text.restoringGroup : text.restoreGroup}
                </button>
              ) : null}
            </div>
          ))
        ) : (
          <p className="dialog-empty">{text.noArchivedGroups}</p>
        )}
      </div>
    </>
  );
}
