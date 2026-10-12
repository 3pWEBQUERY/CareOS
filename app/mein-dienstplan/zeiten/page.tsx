import { Suspense } from "react";
import MyTimes from "../components/my-times";

export default function MyTimesPage() {
  return (
    <Suspense>
      <MyTimes />
    </Suspense>
  );
}
