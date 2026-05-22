import * as React from 'react'
import { Drawer as VaulDrawer } from 'vaul'
import { cn } from '@/lib/utils'

const Drawer = ({ shouldScaleBackground = true, ...props }) => (
  <VaulDrawer.Root shouldScaleBackground={shouldScaleBackground} {...props} />
)
Drawer.displayName = 'Drawer'

const DrawerTrigger = VaulDrawer.Trigger
const DrawerPortal = VaulDrawer.Portal
const DrawerClose = VaulDrawer.Close

const DrawerOverlay = React.forwardRef<any, any>(({ className, ...props }, ref) => (
  <VaulDrawer.Overlay
    ref={ref}
    className={cn('ui:fixed ui:inset-0 ui:z-50 ui:bg-black/70 ui:backdrop-blur-sm', className)}
    {...props}
  />
))
DrawerOverlay.displayName = 'DrawerOverlay'

const DrawerContent = React.forwardRef<any, any>(({ className, children, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <VaulDrawer.Content
      ref={ref}
      className={cn(
        'ui:fixed ui:inset-x-0 ui:bottom-0 ui:z-50 ui:mt-24 ui:flex ui:h-auto ui:flex-col ui:rounded-t-[22px] ui:border ui:border-white/10 ui:bg-fh-onyx ui:shadow-2xl',
        className
      )}
      {...props}
    >
      <div className="ui:mx-auto ui:mt-3 ui:h-1 ui:w-9 ui:rounded-full ui:bg-white/20" />
      {children}
    </VaulDrawer.Content>
  </DrawerPortal>
))
DrawerContent.displayName = 'DrawerContent'

const DrawerHeader = ({ className, ...props }: any) => (
  <div className={cn('ui:grid ui:gap-1 ui:px-4 ui:pt-2 ui:pb-3 ui:text-center ui:sm:text-left', className)} {...props} />
)
const DrawerFooter = ({ className, ...props }: any) => (
  <div className={cn('ui:mt-auto ui:flex ui:flex-col ui:gap-2 ui:p-4', className)} {...props} />
)
const DrawerTitle = React.forwardRef<any, any>(({ className, ...props }, ref) => (
  <VaulDrawer.Title ref={ref} className={cn('ui:text-lg ui:font-semibold ui:leading-none ui:tracking-tight ui:text-foreground', className)} {...props} />
))
DrawerTitle.displayName = 'DrawerTitle'
const DrawerDescription = React.forwardRef<any, any>(({ className, ...props }, ref) => (
  <VaulDrawer.Description ref={ref} className={cn('ui:text-sm ui:text-muted-foreground', className)} {...props} />
))
DrawerDescription.displayName = 'DrawerDescription'

export {
  Drawer, DrawerPortal, DrawerOverlay, DrawerTrigger, DrawerClose,
  DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription
}
