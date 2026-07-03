import { Plus, Ticket } from "lucide-react";
import type { Group, StartMode } from "./appTypes";
import { UI_TEXT } from "./uiText";

type Template = {
  id: string;
  label: string;
  defaultName: string;
};

type StartFlowProps = {
  groups: Group[];
  groupName: string;
  selectedTemplate: string;
  selectedTemplateLabel: string;
  startMode: StartMode;
  templates: Template[];
  onCreateGroup: () => void;
  onGroupNameChange: (name: string) => void;
  onSelectGroup: (group: Group) => void;
  onSelectTemplate: (template: Template) => void;
  onSetStartMode: (mode: StartMode) => void;
  onStatus: (message: string) => void;
};

const text = UI_TEXT.app;

export function StartFlow({ groups, groupName, selectedTemplate, selectedTemplateLabel, startMode, templates, onCreateGroup, onGroupNameChange, onSelectGroup, onSelectTemplate, onSetStartMode, onStatus }: StartFlowProps) {
  return (
    <section className="create-flow-shell">
      <div className="start-flow-card glass-panel">
        <div className="start-copy">
          <p className="eyebrow">Equo</p>
          <h1>{"\u5efa\u7acb\u6216\u52a0\u5165\u4e00\u500b\u7fa4\u7d44"}</h1>
          <p>{"\u5148\u9078\u64c7\u8981\u505a\u7684\u4e8b\uff0c\u518d\u9032\u5165\u7fa4\u7d44\u5167\u8655\u7406\u6210\u54e1\u3001\u652f\u51fa\u8207\u6e05\u511f\u3002"}</p>
        </div>

        <div className="start-mode-picker" aria-label="Start mode">
          {[
            ["create", text.createGroup],
            ["join", text.joinGroup],
            ["continue", text.continueGroup],
          ].map(([id, label]) => (
            <button className={startMode === id ? "start-mode active" : "start-mode"} type="button" key={id} onClick={() => onSetStartMode(id as StartMode)}>
              {label}
            </button>
          ))}
        </div>

        {startMode === "create" ? (
          <section className="start-panel" aria-label={text.createGroup}>
            <div className="panel-title-row">
              <h2>{text.createGroup}</h2>
              <span>Create</span>
            </div>
            <div className="template-grid" aria-label="Templates">
              {templates.map((template) => (
                <button
                  className={selectedTemplate === template.id ? "template-chip active" : "template-chip"}
                  type="button"
                  key={template.id}
                  onClick={() => onSelectTemplate(template)}
                >
                  {template.label}
                </button>
              ))}
            </div>
            <label className="create-name-field">
              <span>{text.groupName}</span>
              <input value={groupName} onChange={(event) => onGroupNameChange(event.target.value)} aria-label={text.groupName} />
            </label>
            <button className="create-submit" type="button" onClick={onCreateGroup}>
              <Plus aria-hidden="true" size={18} />
              {text.createGroup}
              {selectedTemplateLabel}
            </button>
          </section>
        ) : null}

        {startMode === "join" ? (
          <section className="start-panel" aria-label={text.joinGroup}>
            <div className="panel-title-row">
              <h2>{text.joinGroup}</h2>
              <span>Invite</span>
            </div>
            <label>
              <span>{text.inviteCode}</span>
              <input placeholder="EQO..." aria-label={text.inviteCode} />
            </label>
            <button className="secondary-action" type="button" onClick={() => onStatus("Demo \u6a21\u5f0f\u5c1a\u672a\u9023\u63a5\u9080\u8acb\u78bc API\u3002")}>
              <Ticket aria-hidden="true" size={18} />
              {text.joinGroup}
            </button>
          </section>
        ) : null}

        {startMode === "continue" ? (
          <section className="start-panel" aria-label={text.continueGroup}>
            <div className="panel-title-row">
              <h2>{text.continueGroup}</h2>
              <span>{groups.length}</span>
            </div>
            {groups.length ? (
              <div className="group-list">
                {groups.map((group) => (
                  <button className="group-item" type="button" key={group.id} onClick={() => onSelectGroup(group)}>
                    <strong>{group.name}</strong>
                    <span>{group.currency}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="start-empty">
                <p>{text.emptyContinue}</p>
                <button className="secondary-action" type="button" onClick={() => onSetStartMode("create")}>
                  <Plus aria-hidden="true" size={18} />
                  {text.createFirstGroup}
                </button>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </section>
  );
}
