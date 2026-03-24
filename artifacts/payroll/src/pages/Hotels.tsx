import { useState } from "react";
import {
  useListHotels,
  useCreateHotel,
  useUpdateHotel,
  useDeleteHotel,
  useSyncHotels,
  getListHotelsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, Button, Input, StatusBadge, Dialog, Label } from "@/components/ui";
import { Plus, Search, Edit2, Trash2, MapPin, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { Hotel } from "@workspace/api-client-react";

export default function Hotels() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const { data: hotels, isLoading } = useListHotels({ search: search || undefined });
  
  const [isEditing, setIsEditing] = useState<Hotel | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListHotelsQueryKey() });
  const deleteHotel = useDeleteHotel({ mutation: { onSuccess: invalidate }});
  const syncHotels = useSyncHotels({
    mutation: {
      onSuccess: async (result: any) => {
        await invalidate();
        toast({
          title: "Hotels synced",
          description: result?.message || "Hotels and sites updated successfully.",
        });
      },
      onError: (error: any) => {
        toast({
          title: "Hotel sync failed",
          description: error?.response?.data?.error || error?.message || "Unable to sync hotels.",
        });
      },
    },
  });

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this hotel?")) {
      await deleteHotel.mutateAsync({ id });
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-4xl font-extrabold">Hotels & Sites</h1>
          <p className="text-xl text-muted-foreground mt-2">Manage your client worksites and locations.</p>
        </div>
        <div className="flex gap-4">
          <Button onClick={() => syncHotels.mutate()} variant="outline" className="gap-2" isLoading={syncHotels.isPending}>
            <RefreshCw className="w-5 h-5" /> Sync Hotels
          </Button>
          <Button onClick={() => setIsCreating(true)} className="gap-2">
            <Plus className="w-5 h-5" /> Add Hotel
          </Button>
        </div>
      </div>

      <Card className="p-4 flex gap-4 bg-secondary/20">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-6 h-6" />
          <Input 
            placeholder="Search by hotel name or city..." 
            className="pl-12 text-lg h-14"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      <Card className="overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-secondary/80 border-b">
                <th className="p-5 text-lg font-semibold text-muted-foreground">Hotel Name</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground">Location</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground">Region</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground">Contact</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="p-10 text-center text-xl animate-pulse">Loading hotels...</td></tr>}
              {hotels?.map(hotel => (
                <tr key={hotel.id} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
                  <td className="p-5">
                    <p className="text-xl font-bold text-foreground">{hotel.name}</p>
                    <StatusBadge status={hotel.isActive ? 'ready' : 'draft'} />
                  </td>
                  <td className="p-5">
                    <div className="flex items-center gap-2 text-lg">
                      <MapPin className="w-4 h-4 text-muted-foreground" />
                      {hotel.city || 'N/A'}, {hotel.province || 'N/A'}
                    </div>
                  </td>
                  <td className="p-5">
                    <span className="font-semibold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full text-sm">
                      {hotel.region || 'Unassigned'}
                    </span>
                  </td>
                  <td className="p-5">
                    <p className="text-lg">{hotel.contactName || 'No contact'}</p>
                    <p className="text-base text-muted-foreground">{hotel.contactEmail}</p>
                  </td>
                  <td className="p-5 text-right space-x-2">
                    <Button variant="outline" onClick={() => setIsEditing(hotel)} className="px-3">
                      <Edit2 className="w-5 h-5" />
                    </Button>
                    <Button variant="danger" onClick={() => handleDelete(hotel.id)} className="px-3">
                      <Trash2 className="w-5 h-5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {!isLoading && hotels?.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center">
                    <div className="max-w-xl mx-auto space-y-4">
                      <h2 className="text-2xl font-bold text-foreground">No hotels or sites added yet</h2>
                      <p className="text-lg text-muted-foreground">Add a workplace manually or sync hotels from your configured source so hours can be assigned to the correct hotel or site.</p>
                      <div className="flex flex-wrap justify-center gap-3">
                        <Button onClick={() => syncHotels.mutate()} variant="outline" className="gap-2" isLoading={syncHotels.isPending}>
                          <RefreshCw className="w-5 h-5" /> Sync Hotels
                        </Button>
                        <Button onClick={() => setIsCreating(true)} className="gap-2">
                          <Plus className="w-5 h-5" /> Add First Hotel
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <HotelModal 
        open={isCreating || !!isEditing} 
        onClose={() => { setIsCreating(false); setIsEditing(null); }}
        hotel={isEditing}
        onSuccess={invalidate}
      />
    </div>
  );
}

function HotelModal({ open, onClose, hotel, onSuccess }: { open: boolean, onClose: () => void, hotel: Hotel | null, onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const create = useCreateHotel({ mutation: { onSuccess: () => { onSuccess(); onClose(); } }});
  const update = useUpdateHotel({ mutation: { onSuccess: () => { onSuccess(); onClose(); } }});

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: any = {
      name: fd.get("name") as string,
      city: fd.get("city") as string || null,
      province: fd.get("province") as string || null,
      region: fd.get("region") as string || null,
      contactName: fd.get("contactName") as string || null,
      contactEmail: fd.get("contactEmail") as string || null,
      isActive: fd.get("isActive") === "true",
    };

    if (hotel) {
      update.mutate({ id: hotel.id, data });
    } else {
      create.mutate({ data });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose} title={hotel ? "Edit Hotel" : "Add Hotel"}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2 md:col-span-2">
            <Label>Hotel Name *</Label>
            <Input name="name" defaultValue={hotel?.name} required />
          </div>
          <div className="space-y-2">
            <Label>City</Label>
            <Input name="city" defaultValue={hotel?.city || ""} />
          </div>
          <div className="space-y-2">
            <Label>Province</Label>
            <Input name="province" defaultValue={hotel?.province || ""} />
          </div>
          <div className="space-y-2">
            <Label>Region</Label>
            <select name="region" defaultValue={hotel?.region || ""} className="flex min-h-[48px] w-full rounded-xl border-2 border-border bg-background px-4 py-2 text-lg focus:border-primary focus:ring-4 outline-none">
              <option value="">Select Region...</option>
              <option value="GTA">GTA</option>
              <option value="Outside GTA">Outside GTA</option>
              <option value="Ottawa">Ottawa</option>
              <option value="British Columbia">British Columbia</option>
            </select>
          </div>
          {hotel && (
            <div className="space-y-2">
              <Label>Status</Label>
              <select name="isActive" defaultValue={hotel?.isActive ? "true" : "false"} className="flex min-h-[48px] w-full rounded-xl border-2 border-border bg-background px-4 py-2 text-lg focus:border-primary focus:ring-4 outline-none">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          )}
        </div>
        <div className="pt-6 flex justify-end gap-4 border-t border-border">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" isLoading={create.isPending || update.isPending}>
            {hotel ? "Save Changes" : "Create Hotel"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
