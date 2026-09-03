import { UI_TEXT } from "./uiText";

/**
 * Placeholder for the group home card while its detail loads.
 *
 * It mirrors the real card's shape - title, member row, balance lines, the
 * debt ring, the two actions - rather than showing a single centred dot. A dot
 * says "something is happening"; this says "the screen you asked for is
 * arriving, and here is where things will be", so the layout doesn't jump when
 * the data lands.
 *
 * Marked aria-busy and hidden from the accessibility tree: a screen reader
 * should hear the status message, not a description of grey rectangles.
 */
export function GroupHomeSkeleton() {
  return (
    <div className="group-home-card glass-panel skeleton-card enter-content" aria-busy="true" role="status">
      <span className="visually-hidden">{UI_TEXT.app.loadingGroup}</span>
      <div aria-hidden="true">
        <div className="skeleton-title-row">
          <span className="skeleton-line skeleton-line-title" />
          <span className="skeleton-line skeleton-line-sub" />
        </div>

        <div className="skeleton-hero">
          <div className="skeleton-hero-left">
            <div className="skeleton-avatar-stack">
              <span className="skeleton-avatar" />
              <span className="skeleton-avatar" />
              <span className="skeleton-avatar" />
            </div>
            <div className="skeleton-balance-row">
              <span className="skeleton-avatar small" />
              <span className="skeleton-line" />
            </div>
            <div className="skeleton-balance-row">
              <span className="skeleton-avatar small" />
              <span className="skeleton-line short" />
            </div>
          </div>
          <div className="skeleton-donut" />
        </div>

        <div className="skeleton-actions">
          <span className="skeleton-action" />
          <span className="skeleton-action" />
        </div>
      </div>
    </div>
  );
}
