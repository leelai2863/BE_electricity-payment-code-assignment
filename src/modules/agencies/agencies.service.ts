//xu ly logic nghiep vu lien quan den agency o day
//nhan du lieu tho, kiem tra dieu kien, goi repository tuong ung, tra ve ket qua
import { 
  createAgency, 
  deleteAgency, 
  listAgencyOptions, 
  updateAgencyName 
} from "@/lib/agency-repository";
import { agenciesAsTreeRoots } from "@/lib/agency-registry";

export const AgenciesService = {
  async getAllAgencies() {
    return await listAgencyOptions();
  },

  async getAgencyTree() {
    const opts = await listAgencyOptions();
    return agenciesAsTreeRoots(opts);
  },

  async createNewAgency(payload: { name: string; code?: string }) {
    // Bạn có thể thêm logic kiểm tra nghiệp vụ phức tạp ở đây
    return await createAgency(payload);
  },

  async updateName(id: string, name: string) {
    return await updateAgencyName({ id, name });
  },

  async removeAgency(id: string) {
    return await deleteAgency(id);
  }
};