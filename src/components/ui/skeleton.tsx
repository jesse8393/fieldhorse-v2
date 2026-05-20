import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: any) {
  return (
    <div
      data-slot="skeleton"
      className={cn("ui:animate-pulse ui:rounded-md ui:bg-accent", className)}
      {...props} />
  );
}

export { Skeleton }
