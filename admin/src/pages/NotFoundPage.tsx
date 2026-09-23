import { Link } from "react-router-dom";
import { Button } from "../components/ui";

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="text-5xl font-semibold text-gray-300">404</p>
      <p className="text-gray-600">Sahifa topilmadi</p>
      <Link to="/">
        <Button variant="secondary">Dashboardga qaytish</Button>
      </Link>
    </div>
  );
}
