import { UI_TEXT } from "./uiText";

/**
 * What a bottom sheet shows while the panel inside it is still arriving.
 *
 * The sheet shell is in the entry chunk and the panel is not, so between the
 * tap and the chunk landing there is a real gap. It used to be filled with
 * `null`, which meant the sheet rendered at the height of its own padding: a
 * thin empty strip stuck to the bottom of the screen, waiting. Reserving the
 * height instead lets the sheet come up at the size it is going to be, and the
 * shapes fill in.
 *
 * Reuses the group-home skeleton's shimmer (see .skeleton-line in
 * app-base.css), so a slow panel and a slow group look like the same app.
 */
export function PanelSkeleton() {
  return (
    <div className="panel-skeleton" aria-busy="true" role="status">
      <span className="visually-hidden">{UI_TEXT.app.loadingGroup}</span>
      <div aria-hidden="true">
        <span className="skeleton-line skeleton-line-title" />
        <span className="skeleton-line skeleton-line-sub" />
        <div className="panel-skeleton-rows">
          <span className="skeleton-action" />
          <span className="skeleton-action" />
          <span className="skeleton-action" />
          <span className="skeleton-action" />
        </div>
      </div>
    </div>
  );
}
