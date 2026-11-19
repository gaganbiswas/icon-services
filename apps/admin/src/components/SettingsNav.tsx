import { Link } from '@tanstack/react-router';

/** Sub-navigation between settings pages. */
export function SettingsNav() {
  return (
    <nav aria-label="Settings" className="subnav">
      <ul>
        <li>
          <Link to="/settings/invoicing" activeProps={{ 'aria-current': 'page' }}>
            Business and invoicing
          </Link>
        </li>
        <li>
          <Link to="/settings/notifications" activeProps={{ 'aria-current': 'page' }}>
            Notification templates
          </Link>
        </li>
        <li>
          <Link to="/settings/users" activeProps={{ 'aria-current': 'page' }}>
            Users and roles
          </Link>
        </li>
      </ul>
    </nav>
  );
}
