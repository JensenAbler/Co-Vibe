import { Route, Switch } from "wouter";
import { UploadView } from "@/components/upload/UploadView";
import { DAWView } from "@/components/daw/DAWView";

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Switch>
        <Route path="/" component={UploadView} />
        <Route path="/perform" component={DAWView} />
        <Route>
          <div className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground">Page not found</p>
          </div>
        </Route>
      </Switch>
    </div>
  );
}
