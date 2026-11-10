import { useParams } from "react-router-dom";
import IssueView from "../components/IssueView";

export default function IssuePage() {
  const { code = "" } = useParams();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">
        <IssueView key={code} code={code} variant="page" />
      </div>
    </div>
  );
}
