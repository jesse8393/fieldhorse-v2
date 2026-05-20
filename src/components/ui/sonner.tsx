import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import * as React from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner";

const Toaster = ({
  ...props
}: any) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as any}
      className="ui:toaster ui:group"
      icons={{
        success: <CircleCheckIcon className="ui:size-4" />,
        info: <InfoIcon className="ui:size-4" />,
        warning: <TriangleAlertIcon className="ui:size-4" />,
        error: <OctagonXIcon className="ui:size-4" />,
        loading: <Loader2Icon className="ui:size-4 ui:animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)"
        } as React.CSSProperties
      }
      {...props} />
  );
}

export { Toaster }
