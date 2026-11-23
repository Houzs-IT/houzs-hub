import { Meetings } from "./meetings";

// /meetings: the meeting rooms every company shares, the same page as the ERPs'. The page scrolls inside
// itself (the calendar keeps its own scroll), so it fills the main area.
export default function MeetingsPage() {
  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <Meetings erpName="IT Support" />
    </div>
  );
}
