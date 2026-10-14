import { ChevronLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import IssueView from "../components/IssueView";

export default function IssuePage() {
  const { code = "" } = useParams();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">
        <Link to="/tickets" className="tap mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
          <ChevronLeft className="h-4 w-4" /> List
        </Link>
        <IssueView key={code} code={code} variant="page" />
      </div>
    </div>
  );
}
