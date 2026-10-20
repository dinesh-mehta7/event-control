import React from 'react';
import { PermissionsProvider } from './context/PermissionsContext';
import { AppProvider } from './context/AppContext';
import { WalkieProvider, useWalkie } from './modules/walkie';
import { InventoryProvider } from './modules/inventory';
import { PurchaseProvider } from './modules/purchase';
import { AccommodationProvider } from './modules/accommodation';
import { ManpowerProvider } from './modules/manpower';
import { MeetingsProvider } from './context/MeetingsContext';
import { AccessProvider } from './context/AccessContext';
import { RequestsProvider } from './modules/requests';
import { EventScopeProvider } from './context/EventScopeContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Gate } from './shell/Gate';

export default function App() {
  return (
    <ErrorBoundary>
      <WalkieProvider>
        <WorkspaceProviders />
      </WalkieProvider>
    </ErrorBoundary>
  );
}

const WorkspaceProviders: React.FC = () => {
  const { currentUser } = useWalkie() as any;
  return (
    <EventScopeProvider organizationId={currentUser?.organizationId} approved={!!currentUser?.approved}>
      <PermissionsProvider>
        <MeetingsProvider>
          <AppProvider>
            <AccessProvider>
              <AccommodationProvider>
                <ManpowerProvider>
                  <InventoryProvider>
                    <PurchaseProvider>
                      <RequestsProvider>
                        <Gate />
                      </RequestsProvider>
                    </PurchaseProvider>
                  </InventoryProvider>
                </ManpowerProvider>
              </AccommodationProvider>
            </AccessProvider>
          </AppProvider>
        </MeetingsProvider>
      </PermissionsProvider>
    </EventScopeProvider>
  );
};
