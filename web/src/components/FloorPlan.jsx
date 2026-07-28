import { useMemo } from 'react';
import { floorplanSvg } from '../lib/floorplanSvg.js';

// 건축 도면 렌더 — floorplanSvg(순수 문자열)를 반응형으로 감싼다.
export default function FloorPlan({ plan, width = 360 }) {
  const svg = useMemo(() => floorplanSvg(plan, width), [plan, width]);
  return <div className="fplan" dangerouslySetInnerHTML={{ __html: svg }} />;
}
