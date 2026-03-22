import { useState } from "react";
import { useListBusinessProfiles, useCreateBusinessProfile, useDeleteBusinessProfile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, Button, Input, Label, Dialog } from "@/components/ui";
import { Building, Image as ImageIcon, Trash2, ShieldCheck } from "lucide-react";

export default function Settings() {
  const queryClient = useQueryClient();
  const { data: profiles, isLoading } = useListBusinessProfiles();
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);

  const deleteProfile = useDeleteBusinessProfile({ 
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/business-profiles"] }) }
  });

  return (
    <div className="space-y-10 max-w-5xl">
      <div>
        <h1 className="text-4xl font-extrabold">Settings</h1>
        <p className="text-xl text-muted-foreground mt-2">Manage your business profiles and logos for invoicing.</p>
      </div>

      <section>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold flex items-center gap-2"><Building className="w-6 h-6 text-primary"/> Business Profiles</h2>
          <Button onClick={() => setIsCreatingProfile(true)}>Add Profile</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {isLoading && <div className="p-8 animate-pulse text-xl">Loading profiles...</div>}
          {profiles?.map(profile => (
            <Card key={profile.id} className="p-6 relative overflow-hidden group">
              {profile.isDefault && (
                <div className="absolute top-0 right-0 bg-emerald-500 text-white px-4 py-1 rounded-bl-xl font-bold text-sm flex items-center gap-1">
                  <ShieldCheck className="w-4 h-4"/> Default
                </div>
              )}
              <h3 className="text-2xl font-black text-foreground mb-2 pr-20">{profile.businessName}</h3>
              <div className="text-muted-foreground space-y-1 mb-6 text-base">
                <p>{profile.address || 'No address set'}</p>
                <p>{profile.email} • {profile.phone}</p>
                {profile.hstNumber && <p className="font-semibold text-foreground/70 mt-2">HST: {profile.hstNumber}</p>}
              </div>
              <div className="flex justify-between pt-4 border-t border-border">
                <Button variant="outline" className="text-sm px-4 h-10">Edit</Button>
                {!profile.isDefault && (
                  <Button variant="ghost" onClick={() => deleteProfile.mutate({ id: profile.id })} className="text-destructive h-10 px-4">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Simple Profile Create Modal */}
      <Dialog open={isCreatingProfile} onOpenChange={setIsCreatingProfile} title="Add Business Profile">
        <form onSubmit={(e) => { e.preventDefault(); /* Would wire up useCreateBusinessProfile here */ setIsCreatingProfile(false); }} className="space-y-4">
          <div className="space-y-2"><Label>Business Name</Label><Input required /></div>
          <div className="space-y-2"><Label>Address</Label><Input /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Email</Label><Input type="email" /></div>
            <div className="space-y-2"><Label>Phone</Label><Input /></div>
          </div>
          <div className="space-y-2"><Label>HST/Tax Number</Label><Input /></div>
          <Button type="submit" className="w-full mt-4">Save Profile</Button>
        </form>
      </Dialog>
    </div>
  );
}
