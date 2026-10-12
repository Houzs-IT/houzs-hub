import { useParams } from "react-router-dom";
import IssueView from "../components/IssueView";

export default function IssuePage() {
  const { code = "" } = useParams();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1280px] px-8 py-6">
        <div className="eyebrow mb-2">IT Hub · Tickets</div>
        <IssueView key={code} code={code} variant="page" />
      </div>
    </div>
  );
}
