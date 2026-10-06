import type { GuideCondition, GuideEventName, TourStep } from '../../lib/guide/tours';
import type { RouteHash } from '../router';

const EVENTS = {
  'has-documents': 'documents-imported',
  'has-protocol': 'protocol-saved',
  'has-confirmed-schema': 'schema-confirmed',
} as const;

/** 状態の立ち上がりだけを通知する。サービスの成功経路には依存しない。 */
export function guideEvents(
  before: Record<GuideCondition, boolean>, after: Record<GuideCondition, boolean>,
): GuideEventName[] {
  return (Object.keys(EVENTS) as Array<keyof typeof EVENTS>)
    .filter(condition => !before[condition] && after[condition])
    .map(condition => EVENTS[condition]);
}

export function routeGuideEvent(route: RouteHash): GuideEventName {
  return `route-opened-${route.slice(2)}` as GuideEventName;
}

export function isSatisfiedByRoute(step: TourStep, route: string): boolean {
  return step.advance.type === 'events' && step.advance.events.some(event => event === `route-opened-${route.slice(2)}`);
}
